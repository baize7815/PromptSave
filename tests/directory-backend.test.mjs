import test from "node:test";
import assert from "node:assert/strict";

// The storage backends pull in modules that touch the extension APIs at
// module-evaluation time (e.g. debug-log.js registers a chrome.storage
// listener). Install a minimal stub before dynamically importing them.
globalThis.chrome = {
  storage: {
    local: {
      async get() { return {}; },
      async set() {},
      async remove() {}
    },
    onChanged: { addListener() {} }
  }
};

const { DirectoryBackend } = await import("../PromptSave/storage/directory-backend.js");
const { createEmptyData, createItem, bumpRevision } = await import("../PromptSave/shared/model.js");

function notFound() {
  const error = new Error("not found");
  error.name = "NotFoundError";
  return error;
}

class FakeFileHandle {
  constructor(path, files, writes) {
    this.kind = "file";
    this.path = path;
    this.files = files;
    this.writes = writes;
  }

  async getFile() {
    if (!this.files.has(this.path)) throw notFound();
    const value = this.files.get(this.path);
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    return {
      async text() {
        return typeof value === "string" ? value : new TextDecoder().decode(value);
      },
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    };
  }

  async createWritable() {
    let pending = null;
    return {
      write: async (value) => {
        if (typeof value === "string") pending = value;
        else if (value instanceof Uint8Array) pending = new Uint8Array(value);
        else if (value instanceof ArrayBuffer) pending = new Uint8Array(value);
        else throw new Error("unsupported write");
      },
      close: async () => {
        if (this.files.failWritePath === this.path) throw new Error("simulated write failure");
        this.files.set(this.path, pending);
        this.writes.push(this.path);
      }
    };
  }
}

class FakeDirectoryHandle {
  constructor(path = "", shared = null) {
    this.kind = "directory";
    this.name = path ? path.split("/").pop() : "library";
    this.path = path;
    this.shared = shared || {
      files: new Map(),
      dirs: new Set([""]),
      writes: [],
      permission: "granted"
    };
  }

  full(name) {
    return this.path ? this.path + "/" + name : name;
  }

  queryPermission() {
    return Promise.resolve(this.shared.permission);
  }

  keys() {
    const values = [];
    for (const path of this.shared.files.keys()) {
      if (!path.includes("/") && !this.path) values.push(path);
    }
    return {
      next: async () => ({ done: !values.length, value: values[0] })
    };
  }

  async getFileHandle(name, options = {}) {
    const path = this.full(name);
    if (!this.shared.files.has(path) && !options.create) throw notFound();
    if (!this.shared.files.has(path) && options.create) this.shared.files.set(path, new Uint8Array());
    return new FakeFileHandle(path, this.shared.files, this.shared.writes);
  }

  async getDirectoryHandle(name, options = {}) {
    const path = this.full(name);
    if (!this.shared.dirs.has(path) && !options.create) throw notFound();
    if (options.create) this.shared.dirs.add(path);
    return new FakeDirectoryHandle(path, this.shared);
  }

  async removeEntry(name) {
    const path = this.full(name);
    if (!this.shared.files.delete(path)) throw notFound();
  }
}

function makeImage(id = "img-a") {
  return {
    id,
    path: "images/" + id + ".jpg",
    filename: id + ".jpg",
    mime: "image/jpeg",
    width: 10,
    height: 10,
    bytes: 5
  };
}

test("目录写入先落图片再提交 data.json", async () => {
  const root = new FakeDirectoryHandle();
  const backend = new DirectoryBackend(root);
  const data = createEmptyData();
  data.items.push(createItem({ title: "图", image: makeImage() }));
  const jpeg = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString("base64");

  await backend.saveDataset(data, { imageWrites: { "img-a": jpeg } });

  assert.deepEqual(root.shared.writes, ["images/img-a.jpg", "data.json"]);
  assert.ok(root.shared.files.has("data.json"));
});

test("同修订号但内容被外部改动时拒绝覆盖", async () => {
  const root = new FakeDirectoryHandle();
  const backend = new DirectoryBackend(root);
  const previous = createEmptyData();
  previous.items.push(createItem({ title: "原始", prompt: "a" }));
  root.shared.files.set("data.json", JSON.stringify(previous));

  const external = structuredClone(previous);
  external.items[0].title = "外部改过";
  root.shared.files.set("data.json", JSON.stringify(external));

  const next = bumpRevision(structuredClone(previous));
  next.items[0].prompt = "扩展准备写入";

  await assert.rejects(
    () => backend.saveDataset(next, { previous }),
    (error) => error && error.code === "EXTERNAL_CHANGE"
  );
  assert.equal(JSON.parse(root.shared.files.get("data.json")).items[0].title, "外部改过");
});

test("缺图与授权失效被区分", async () => {
  const root = new FakeDirectoryHandle();
  root.shared.dirs.add("images");
  const backend = new DirectoryBackend(root);
  const ref = makeImage("img-missing");

  const missing = await backend.readImage(ref);
  assert.equal(missing.status, "missing");

  root.shared.permission = "denied";
  const permission = await backend.readImage(ref);
  assert.equal(permission.status, "permission");
});

test("永久删除过程中 data.json 写入失败会恢复已删图片并保留旧数据", async () => {
  const root = new FakeDirectoryHandle();
  root.shared.dirs.add("images");
  const backend = new DirectoryBackend(root);
  const previous = createEmptyData();
  previous.items.push(createItem({ id: "item-a", title: "保留", image: makeImage("img-a") }));
  const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9]);
  root.shared.files.set("data.json", JSON.stringify(previous));
  root.shared.files.set("images/img-a.jpg", jpeg);

  const next = bumpRevision({ ...previous, items: [] });
  root.shared.files.failWritePath = "data.json";

  await assert.rejects(() => backend.saveDataset(next, {
    previous,
    imageDeletes: ["img-a"]
  }));

  delete root.shared.files.failWritePath;
  assert.equal(JSON.parse(root.shared.files.get("data.json")).items.length, 1);
  assert.deepEqual([...root.shared.files.get("images/img-a.jpg")], [...jpeg]);
});
