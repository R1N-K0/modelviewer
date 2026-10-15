// Prints the three.js teapot as JSON for make_models.py: {"positions": [...], "index": [...]}.
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';

const segments = Number(process.argv[2]);
// size, segments, bottom, lid, body, fitLid, blinn. fitLid seats the lid on the rim, which the
// Utah OBJ left floating a little below it.
const geometry = new TeapotGeometry(1, segments, true, true, true, true, true);
process.stdout.write(JSON.stringify({
  positions: Array.from(geometry.attributes.position.array),
  index: Array.from(geometry.index.array),
}));
