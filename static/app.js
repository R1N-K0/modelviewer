import {
  Color, DirectionalLight, HemisphereLight, MeshStandardMaterial, PerspectiveCamera,
  Scene, Sphere, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';

const MODELS = ['dragon', 'bunny', 'teapot'];
// The share of the remaining drag that is applied in one 60 Hz frame. OrbitControls' default,
// 0.05, glides on for about a second after the finger lifts, which overshoots the view that
// was aimed at; at 0.2 the glide is down to 3.5% in about 0.25 s.
const DAMPING_PER_60HZ_FRAME = 0.2;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 10;
// Seen from the front and a little above, the usual way to look at an object on a table.
const HOME_DIRECTION = [0, 0.3, 1];
const HOME_ELEVATION = Math.atan2(HOME_DIRECTION[1], Math.hypot(HOME_DIRECTION[0], HOME_DIRECTION[2]));
const MARGIN = 1.05;

const canvas = document.getElementById('view');
const buttons = [...document.querySelectorAll('#models button')];
const themeButton = document.getElementById('theme');

const renderer = new WebGLRenderer({ canvas, antialias: true });

const scene = new Scene();
scene.background = new Color();
// Low enough that the brightest face stays darker than the light background, so the outline
// shows; on the dark one it is lighter instead.
scene.add(new HemisphereLight(0xffffff, 0x8a8a8a, 1.2));

const camera = new PerspectiveCamera(40, 1, 0.01, 100);
// A drag moves the camera round the object, not the object. A light fixed in the world would
// leave the side turned to the viewer dark from half the angles, so it goes round with the camera.
const sun = new DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 1.5, 0.5);
camera.add(sun);
scene.add(camera);

const material = new MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.8 });

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = DAMPING_PER_60HZ_FRAME;
controls.enablePan = false;

const loader = new GLTFLoader();
const loaded = new Map();
let shown = null;
let shownName = null;
let current = null;
let sphere = new Sphere();
let cylinder = { radius: 0, half: 0 };
let fitted = 0;

// Fitted to the upright cylinder round the model rather than its bounding sphere: a sideways
// drag turns about Y, which leaves the cylinder's outline unchanged, and on a tall phone screen
// the sphere is wider than anything the turn ever shows. Seen from above at an elevation, the
// cylinder's top rim adds to its height on screen. A user who tilts far from the home elevation
// may see it reach past the edge; zooming out brings it back.
function fitDistance() {
  const vertical = camera.fov * Math.PI / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  const height = cylinder.half * Math.cos(HOME_ELEVATION) + cylinder.radius * Math.sin(HOME_ELEVATION);
  return MARGIN * Math.max(
    cylinder.radius / Math.sin(horizontal / 2),
    height / Math.sin(vertical / 2),
  );
}

// Keeps whatever zoom the user chose, relative to the fit, when the window changes shape.
function refit(home) {
  const distance = fitDistance();
  const offset = camera.position.clone().sub(controls.target);
  if (home || fitted === 0 || offset.lengthSq() === 0) {
    offset.set(...HOME_DIRECTION).setLength(distance);
  } else {
    offset.multiplyScalar(distance / fitted);
  }
  fitted = distance;
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(offset);
  controls.minDistance = sphere.radius;
  controls.maxDistance = distance * 3;
  camera.near = sphere.radius * 0.01;
  camera.far = distance * 3 + sphere.radius * 2;
  camera.updateProjectionMatrix();
  controls.update();
  wake();
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  // devicePixelRatio changes when the window moves to another monitor or the page is zoomed.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (shown) refit(false);
}

function prepare(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bounds = new Sphere();
  let first = true;
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
    child.material = material;
    child.geometry.computeBoundingSphere();
    const part = child.geometry.boundingSphere.clone().applyMatrix4(child.matrixWorld);
    if (first) bounds.copy(part); else bounds.union(part);
    first = false;
  });
  const cylinder = { radius: 0, half: 0 };
  const point = new Vector3();
  root.traverse((child) => {
    if (!child.isMesh) return;
    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld).sub(bounds.center);
      cylinder.radius = Math.max(cylinder.radius, Math.hypot(point.x, point.z));
      cylinder.half = Math.max(cylinder.half, Math.abs(point.y));
    }
  });
  return { root, bounds, cylinder };
}

function load(name) {
  if (!loaded.has(name)) {
    const promise = loader.loadAsync(`models/${name}.glb`).then(prepare);
    promise.catch(() => loaded.delete(name));
    loaded.set(name, promise);
  }
  return loaded.get(name);
}

function mark(name) {
  history.replaceState(null, '', name ? `#${name}` : location.pathname);
  for (const button of buttons) {
    button.classList.toggle('selected', button.dataset.model === name);
  }
}

async function select(name) {
  if (!MODELS.includes(name)) name = MODELS[0];
  if (name === current) return;
  current = name;
  mark(name);
  const button = buttons.find((b) => b.dataset.model === name);
  button.classList.add('loading');
  let model;
  try {
    model = await load(name);
  } catch {
    // Back to what is on screen, so pressing the same button again tries again.
    if (name === current) {
      current = shownName;
      mark(shownName);
    }
    return;
  } finally {
    button.classList.remove('loading');
  }
  if (name !== current) return;
  if (shown) scene.remove(shown);
  shown = model.root;
  shownName = name;
  scene.add(shown);
  sphere = model.bounds;
  cylinder = model.cylinder;
  refit(true);
}

let running = false;
let dragging = false;
let dirty = true;
let last = null;

function frame(now) {
  // The first frame after a wake has no frame before it; counted as none, it would damp by
  // nothing, nothing would move, and the loop would stop with the glide still owed.
  const seconds = last === null ? 1 / 60 : Math.min(Math.max(now - last, 0) / 1000, 0.1);
  last = now;
  // OrbitControls damps by a share per call, so a 120 Hz phone would stop in half the time of a
  // 60 Hz screen. Scaled by the time since the last frame, the glide lasts the same everywhere.
  controls.dampingFactor = 1 - Math.pow(1 - DAMPING_PER_60HZ_FRAME, seconds * 60);
  const moved = controls.update();
  if (moved || dirty) {
    renderer.render(scene, camera);
    dirty = false;
  }
  if (document.hidden || !(moved || dragging)) {
    running = false;
    return;
  }
  requestAnimationFrame(frame);
}

function wake() {
  dirty = true;
  if (running || document.hidden) return;
  running = true;
  last = null;
  requestAnimationFrame(frame);
}

controls.addEventListener('change', wake);
controls.addEventListener('start', () => {
  dragging = true;
  wake();
});
controls.addEventListener('end', () => {
  dragging = false;
});

// dblclick is not fired for a double tap on every phone, so taps are counted here for mouse
// and finger alike. Only the primary pointer counts, so lifting two fingers is not a double tap.
let down = null;
let lastTap = 0;
canvas.addEventListener('pointerdown', (event) => {
  down = event.isPrimary ? { x: event.clientX, y: event.clientY } : null;
});
canvas.addEventListener('pointerup', (event) => {
  if (!down || !event.isPrimary) return;
  const still = Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_SLOP_PX;
  down = null;
  if (!still) {
    lastTap = 0;
    return;
  }
  if (event.timeStamp - lastTap < DOUBLE_TAP_MS) {
    lastTap = 0;
    if (shown) refit(true);
  } else {
    lastTap = event.timeStamp;
  }
});

// The colour is kept in style.css alone, so the canvas and the page cannot drift apart.
function applyTheme() {
  scene.background.set(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  wake();
}

themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  applyTheme();
});

for (const button of buttons) {
  button.addEventListener('click', () => select(button.dataset.model));
}
addEventListener('hashchange', () => select(location.hash.slice(1)));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) wake();
});
new ResizeObserver(resize).observe(canvas);

applyTheme();
resize();
select(location.hash.slice(1));
