import {
  Box3, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  NearestFilter, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Sphere, Vector2,
  Vector3, WebGLRenderer, WebGLRenderTarget,
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
// The mask look copies maskeditor's render.py, so a mask drawn there can be compared by eye
// with what one from this viewpoint would be. The colours are not part of the page's theme:
// they are the pixel classes of the dataset (data/objects.json in maskeditor), one class per
// shape: dragon is gray_dragon, teapot blue_pot, bunny yellow_bunny.
const MASK_COLORS = {
  dragon: [230, 25, 75],
  teapot: [255, 225, 25],
  bunny: [245, 130, 48],
};
// The long side, in photo pixels, of each shape's mask at its usual size in the dataset's
// 1920x1440 photos: the median long side of the bounding box of the object's mask over 150
// sampled ok masks (2026-10-19), one round number for the classes of each shape (dragon 256 and
// 242, teapot 155 and 156, bunny 196, 198 and 212).
const MASK_PHOTO_SIZE = {
  dragon: 250,
  teapot: 155,
  bunny: 200,
};
// render.py's ALPHA: the share of the class colour inside the mask.
const MASK_ALPHA = 0.18;
// The widest outline the shader looks for, in drawing-buffer pixels. Above anything the closest
// zoom gives, so it only bounds the loop.
const MASK_MAX_EDGE = 32;

const canvas = document.getElementById('view');
const buttons = [...document.querySelectorAll('#models button')];
const themeButton = document.getElementById('theme');
const maskButton = document.getElementById('mask');

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

// The silhouette is drawn alone into a texture, then a pass over the whole screen lays the mask
// on the picture. The texture has no antialiasing, so each pixel is in or out like a mask's.
const maskTarget = new WebGLRenderTarget(1, 1, {
  minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false,
});
// The same side as the shaded material, so the mask covers exactly the pixels the model is drawn
// on: a gap that shows the background through the dragon stays a hole, as it would in a photo.
const silhouette = new MeshBasicMaterial({ color: 0xffffff, side: material.side });
// Plain alpha blending over the finished picture is render.py's over(): picture * (1 - a) +
// colour * a, with a = 1 on the outline. Both work on the sRGB values as stored, so the colour is
// given as those values and the shader leaves out three.js's colour space conversion.
const overlayMaterial = new ShaderMaterial({
  uniforms: {
    mask: { value: maskTarget.texture },
    size: { value: new Vector2(1, 1) },
    edgeWidth: { value: 1 },
    color: { value: new Vector3() },
    alpha: { value: MASK_ALPHA },
  },
  vertexShader: `
    void main() {
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  // render.py's find_edges(): a mask pixel with a 4-neighbour outside is outline, so the line
  // lies just inside the boundary. Here a photo pixel spans edgeWidth screen pixels, so the
  // neighbours are looked for along the row and the column up to that distance, as find_edges
  // looks only along rows and columns. The border of the picture is not an edge there either,
  // which reading past it here gives too, as the texture is clamped to its last row and column.
  defines: { MAX_EDGE: MASK_MAX_EDGE },
  fragmentShader: `
    uniform sampler2D mask;
    uniform vec2 size;
    uniform float edgeWidth;
    uniform vec3 color;
    uniform float alpha;
    float inside(vec2 offset) {
      return texture2D(mask, (gl_FragCoord.xy + offset) / size).r;
    }
    void main() {
      if (inside(vec2(0.0)) < 0.5) discard;
      for (int k = 1; k <= MAX_EDGE; k++) {
        float d = float(k);
        if (d > edgeWidth) break;
        float around = min(min(inside(vec2(d, 0.0)), inside(vec2(-d, 0.0))),
                           min(inside(vec2(0.0, d)), inside(vec2(0.0, -d))));
        if (around < 0.5) {
          gl_FragColor = vec4(color, 1.0);
          return;
        }
      }
      gl_FragColor = vec4(color, alpha);
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const overlayQuad = new Mesh(new PlaneGeometry(2, 2), overlayMaterial);
overlayQuad.frustumCulled = false;
const overlay = new Scene();
overlay.add(overlayQuad);
let masked = false;
let maskPrepared = false;

const loader = new GLTFLoader();
const loaded = new Map();
let shown = null;
let shownName = null;
let current = null;
let sphere = new Sphere();
let cylinder = { radius: 0, half: 0 };
let longSide = 0;
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
  const size = renderer.getDrawingBufferSize(overlayMaterial.uniforms.size.value);
  maskTarget.setSize(size.x, size.y);
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
  const box = new Box3();
  const point = new Vector3();
  root.traverse((child) => {
    if (!child.isMesh) return;
    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      box.expandByPoint(point);
      point.sub(bounds.center);
      cylinder.radius = Math.max(cylinder.radius, Math.hypot(point.x, point.z));
      cylinder.half = Math.max(cylinder.half, Math.abs(point.y));
    }
  });
  const extent = box.getSize(new Vector3());
  return { root, bounds, cylinder, longSide: Math.max(extent.x, extent.y, extent.z) };
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
  longSide = model.longSide;
  refit(true);
  // The first press of the mask button would otherwise wait for the mask's shaders and texture
  // to be built, most of a frame; done once here, off screen, while the first model appears.
  if (!maskPrepared) {
    drawSilhouette();
    renderer.compile(overlay, camera);
    maskPrepared = true;
  }
}

let running = false;
let dragging = false;
let gliding = false;
let dirty = true;
let last = null;
const lastPosition = new Vector3();

// maskeditor's outline is one photo pixel, scaled with the photo when zoomed. How large a photo
// pixel is on the object depends on how far the camera was, not on how the object was turned, so
// the width here follows only the camera's distance: the model's long side in pixels, as if it
// stood square to the camera at the target, over its long side in the photos.
function edgeWidth() {
  const height = overlayMaterial.uniforms.size.value.y;
  const distance = camera.position.distanceTo(sphere.center);
  const pixelsPerUnit = height / (2 * Math.tan(camera.fov * Math.PI / 360) * distance);
  // Whole pixels, as maskeditor's edge is.
  const width = Math.round(longSide * pixelsPerUnit / MASK_PHOTO_SIZE[shownName]);
  return Math.min(Math.max(width, 1), MASK_MAX_EDGE);
}

function drawSilhouette() {
  const background = scene.background;
  scene.background = null;
  scene.overrideMaterial = silhouette;
  renderer.setRenderTarget(maskTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  scene.background = background;
}

function drawMask() {
  drawSilhouette();
  overlayMaterial.uniforms.color.value.fromArray(MASK_COLORS[shownName]).divideScalar(255);
  overlayMaterial.uniforms.edgeWidth.value = edgeWidth();
  renderer.autoClear = false;
  renderer.render(overlay, camera);
  renderer.autoClear = true;
}

function draw() {
  renderer.render(scene, camera);
  if (masked && shown) drawMask();
}

function frame(now) {
  // The first frame after a wake has no frame before it; counted as none, it would damp by
  // nothing, nothing would move, and the loop would stop with the glide still owed.
  const seconds = last === null ? 1 / 60 : Math.min(Math.max(now - last, 0) / 1000, 0.1);
  last = now;
  // OrbitControls damps by a share per call, so a 120 Hz phone would stop in half the time of a
  // 60 Hz screen. Scaled by the time since the last frame, the glide lasts the same everywhere.
  controls.dampingFactor = 1 - Math.pow(1 - DAMPING_PER_60HZ_FRAME, seconds * 60);
  // A glide ends when update() reports false: the step it just took is under OrbitControls'
  // EPS. That step still moved the camera, and OrbitControls still holds the rest of the turn,
  // four times that step at 60 Hz, paying out another share on each update(). So the last step is
  // drawn, and update() runs only while the controls are in use; otherwise a wake that only
  // redraws (the mask or background button) would move the model. The rest goes into the next
  // drag or zoom.
  let moved = gliding && controls.update();
  // At the closest or farthest zoom OrbitControls can report a change on every call: the
  // distance it reads back from the camera is a rounding error off the limit, and clamping it
  // counts as a zoom. The camera then moves by a rounding error at most, and without this the
  // loop would never stop (3 to 7 view directions in 100 at the closest zoom).
  if (camera.position.distanceTo(lastPosition) <= sphere.radius * 1e-9) moved = false;
  lastPosition.copy(camera.position);
  const stopping = !(moved || dragging);
  if (moved || dirty || (gliding && stopping)) {
    draw();
    dirty = false;
  }
  if (stopping) gliding = false;
  if (document.hidden || !gliding) {
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

controls.addEventListener('change', () => {
  gliding = true;
  wake();
});
controls.addEventListener('start', () => {
  dragging = true;
  gliding = true;
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

// Kept per browser like the theme, so someone checking masks finds the mask look still on.
function applyMask(on) {
  masked = on;
  maskButton.setAttribute('aria-pressed', String(on));
  wake();
}

maskButton.addEventListener('click', () => {
  try {
    localStorage.setItem('mask', masked ? 'off' : 'on');
  } catch {}
  applyMask(!masked);
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
let savedMask = null;
try { savedMask = localStorage.getItem('mask'); } catch {}
applyMask(savedMask === 'on');
resize();
select(location.hash.slice(1));
