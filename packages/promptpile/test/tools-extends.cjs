'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const { loadToolsTomlResolved } = require(path.join(rootDir, 'dist', 'tools-loader.js'));

const toolDesc = (tools, name) => {
  const t = tools.find(x => x.function && x.function.name === name);
  return t ? t.function.description : undefined;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ext-'));
try {
  const base = path.join(tmp, 'base.toml');
  const mid = path.join(tmp, 'mid.toml');
  const root = path.join(tmp, 'root.toml');
  fs.writeFileSync(
    base,
    `[[tools]]
name = "shared"
description = "from-base"
parameters = { type = "object", properties = {} }
`
  );
  fs.writeFileSync(
    mid,
    `extends = ["./base.toml"]
[[tools]]
name = "shared"
description = "from-mid"
parameters = { type = "object", properties = {} }
`
  );
  fs.writeFileSync(
    root,
    `extends = ["./mid.toml"]
[[tools]]
name = "shared"
description = "from-root"
parameters = { type = "object", properties = {} }
`
  );
  const merged = loadToolsTomlResolved(root, new Set(), 0);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(toolDesc(merged, 'shared'), 'from-root', 'root tools override extends chain');

  const a = path.join(tmp, 'a.toml');
  const b = path.join(tmp, 'b.toml');
  fs.writeFileSync(a, 'extends = ["./b.toml"]\n[[tools]]\nname = "x"\ndescription = "a"\nparameters = {}\n');
  fs.writeFileSync(b, 'extends = ["./a.toml"]\n[[tools]]\nname = "x"\ndescription = "b"\nparameters = {}\n');
  assert.throws(() => loadToolsTomlResolved(a, new Set(), 0), /Circular tools extends/);

  const chainDir = path.join(tmp, 'chain');
  fs.mkdirSync(chainDir, { recursive: true });
  for (let i = 0; i <= 32; i++) {
    const name = path.join(chainDir, `f${i}.toml`);
    if (i < 32) {
      fs.writeFileSync(name, `extends = ["./f${i + 1}.toml"]\n`);
    } else {
      fs.writeFileSync(
        name,
        `extends = ["./f${i + 1}.toml"]
[[tools]]
name = "deep"
description = "x"
parameters = {}
`
      );
    }
  }
  const deep33 = path.join(chainDir, 'f33.toml');
  fs.writeFileSync(
    deep33,
    `[[tools]]
name = "deep"
description = "leaf"
parameters = {}
`
  );
  assert.throws(() => loadToolsTomlResolved(path.join(chainDir, 'f0.toml'), new Set(), 0), /depth exceeds/);

  const bx = path.join(tmp, 'bx.toml');
  const cx = path.join(tmp, 'cx.toml');
  const rx = path.join(tmp, 'rx.toml');
  fs.writeFileSync(
    bx,
    `[[tools]]
name = "onlyB"
description = "b-only"
parameters = {}
`
  );
  fs.writeFileSync(
    cx,
    `[[tools]]
name = "onlyB"
description = "c-wins-over-b-same-name"
parameters = {}
`
  );
  fs.writeFileSync(
    rx,
    `extends = ["./bx.toml", "./cx.toml"]
`
  );
  const order = loadToolsTomlResolved(rx, new Set(), 0);
  assert.strictEqual(toolDesc(order, 'onlyB'), 'c-wins-over-b-same-name', 'later extends sibling wins');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('tools-extends tests ok');
