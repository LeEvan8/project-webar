// Check if WebXR is available
const isXRSupported = navigator.xr && navigator.xr.isSessionSupported;
    
// UI elements
const startButton = document.getElementById('startButton');
const loadingMessage = document.getElementById('loadingMessage');
const measurementDisplay = document.getElementById('measurement');
const resetButton = document.getElementById('resetButton');
const plusButton = document.getElementById('plusButton');
const instructionText = document.getElementById('instructionText');

// Three.js variables
let camera, scene, renderer;
let controller;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;

// Measurement variables
let measurementPoints = [];
let measuringLine = null;
let pointMeshes = [];
let measurements = [];
let currentMeasurement = null;
let isMultiMeasuring = false;

// Initialize only if supported
if (!isXRSupported) {
  startButton.innerHTML = "AR Not Available";
  startButton.disabled = true;
  startButton.style.backgroundColor = "#888";
} else {
  startButton.addEventListener('click', initAR);
}

// UI Event Listeners
resetButton.addEventListener('click', resetMeasurement);
plusButton.addEventListener('click', startMultiMeasurement);

function initAR() {
  startButton.style.display = 'none';
  loadingMessage.style.display = 'block';
  
  // Initialize the renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.xr.enabled = true;
  document.getElementById('container').appendChild(renderer.domElement);
  
  // Create scene
  scene = new THREE.Scene();
  
  // Set up camera
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  
  // Add light
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);
  
  // Create reticle for hit testing (visualization of detected plane)
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.04, 0.05, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  
  // Set up controller for tap detection
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);
  
  // Check if immersive-ar is supported
  navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
    if (supported) {
      startARSession();
    } else {
      loadingMessage.innerHTML = "AR not supported on this device";
    }
  });
  
  // Handle window resize
  window.addEventListener('resize', onWindowResize);
}

function startARSession() {
  const sessionInit = {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
  };
  
  if ('dom-overlay' in sessionInit.optionalFeatures) {
    sessionInit.domOverlay = { root: document.getElementById('container') };
  }
  
  navigator.xr.requestSession('immersive-ar', sessionInit)
    .then(onSessionStarted)
    .catch(error => {
      loadingMessage.innerHTML = "Error starting AR: " + error;
    });
}

function onSessionStarted(session) {
  loadingMessage.style.display = 'none';
  
  session.addEventListener('end', onSessionEnded);
  
  renderer.xr.setReferenceSpaceType('local');
  renderer.xr.setSession(session);
  
  animate();
}

function onSessionEnded() {
  resetMeasurement();
  startButton.style.display = 'block';
  instructionText.innerHTML = "Point at a surface to start measuring";
}

function onSelect() {
  if (reticle.visible) {
    const position = new THREE.Vector3();
    position.setFromMatrixPosition(reticle.matrix);
    
    if (measurementPoints.length === 0) {
      // First point
      createMeasurementPoint(position);
      instructionText.innerHTML = "Now point to the end position and tap";
    } else if (measurementPoints.length === 1 && !isMultiMeasuring) {
      // Second point
      createMeasurementPoint(position);
      updateMeasurementLine();
      calculateAndDisplayMeasurement();
      resetButton.style.opacity = '1';
      plusButton.style.opacity = '1';
      instructionText.innerHTML = "Tap + to add another measurement or Reset to start over";
    } else if (isMultiMeasuring) {
      // Multi-measurement mode
      if (currentMeasurement === null) {
        // Start a new measurement
        currentMeasurement = {
          points: [],
          line: null,
          distance: 0
        };
        measurements.push(currentMeasurement);
      }
      
      currentMeasurement.points.push(position.clone());
      createMeasurementPoint(position);
      
      if (currentMeasurement.points.length >= 2) {
        updateCurrentMultiMeasurementLine();
        calculateAndDisplayMultiMeasurement();
      }
      
      instructionText.innerHTML = "Tap again to continue measuring or Reset to start over";
    }
  }
}

function createMeasurementPoint(position) {
  // Create a visual point in 3D space
  const pointGeometry = new THREE.SphereGeometry(0.01, 16, 16);
  const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const pointMesh = new THREE.Mesh(pointGeometry, pointMaterial);
  pointMesh.position.copy(position);
  scene.add(pointMesh);
  pointMeshes.push(pointMesh);
  
  // Store the position
  measurementPoints.push(position);
}

function updateMeasurementLine() {
  if (measurementPoints.length >= 2) {
    // Remove existing line if any
    if (measuringLine) {
      scene.remove(measuringLine);
    }
    
    // Create a line between the two points
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      measurementPoints[0],
      measurementPoints[1]
    ]);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
    measuringLine = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(measuringLine);
  }
}

function updateCurrentMultiMeasurementLine() {
  if (!currentMeasurement || currentMeasurement.points.length < 2) return;
  
  // Remove existing line if any
  if (currentMeasurement.line) {
    scene.remove(currentMeasurement.line);
  }
  
  // Create a line between all points
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(currentMeasurement.points);
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
  currentMeasurement.line = new THREE.Line(lineGeometry, lineMaterial);
  scene.add(currentMeasurement.line);
}

function calculateAndDisplayMeasurement() {
  if (measurementPoints.length >= 2) {
    const distance = measurementPoints[0].distanceTo(measurementPoints[1]);
    displayMeasurement(distance);
  }
}

function calculateAndDisplayMultiMeasurement() {
  if (!currentMeasurement || currentMeasurement.points.length < 2) return;
  
  let totalDistance = 0;
  for (let i = 1; i < currentMeasurement.points.length; i++) {
    totalDistance += currentMeasurement.points[i-1].distanceTo(currentMeasurement.points[i]);
  }
  
  currentMeasurement.distance = totalDistance;
  displayMeasurement(totalDistance);
}

function displayMeasurement(distance) {
  // Convert to meters and format
  const meters = distance.toFixed(2);
  measurementDisplay.textContent = `${meters} m`;
  measurementDisplay.style.opacity = '1';
}

function resetMeasurement() {
  // Clear all measurement points
  measurementPoints = [];
  
  // Remove visual points
  pointMeshes.forEach(mesh => scene.remove(mesh));
  pointMeshes = [];
  
  // Remove measurement line
  if (measuringLine) {
    scene.remove(measuringLine);
    measuringLine = null;
  }
  
  // Clear all multi-measurements
  measurements.forEach(m => {
    if (m.line) scene.remove(m.line);
  });
  measurements = [];
  currentMeasurement = null;
  isMultiMeasuring = false;
  
  // Reset UI
  measurementDisplay.style.opacity = '0';
  resetButton.style.opacity = '0';
  plusButton.style.opacity = '0';
  instructionText.innerHTML = "Point at a surface to start measuring";
}

function startMultiMeasurement() {
  resetMeasurement();
  isMultiMeasuring = true;
  resetButton.style.opacity = '1';
  plusButton.style.opacity = '1';
  instructionText.innerHTML = "Tap points to create a connected measurement";
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();
    
    if (hitTestSourceRequested === false) {
      session.requestReferenceSpace('viewer').then((referenceSpace) => {
        session.requestHitTestSource({ space: referenceSpace }).then((source) => {
          hitTestSource = source;
        });
      });
      
      hitTestSourceRequested = true;
    }
    
    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      
      if (hitTestResults.length) {
        const hit = hitTestResults[0];
        reticle.visible = true;
        reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }
  
  renderer.render(scene, camera);
}