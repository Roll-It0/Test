const http = require("http");
const { parseChunk } = require("./core/reader");
const { unshuffleProto } = require("./core/unshuffler");
const { disassembleProto } = require("./core/disassembler");
const { decompileProto } = require("./core/decompiler");

const PORT = process.env.PORT || 3000;

const send = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/decompile") {
    return send(res, 404, { error: "ROUTE_NOT_FOUND" });
  }

  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 5242880) req.destroy();
  });

  req.on("end", () => {
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      return send(res, 400, { error: "INVALID_JSON" });
    }

    if (!json.bytecode || typeof json.bytecode !== "string") {
      return send(res, 400, { error: "BYTECODE_REQUIRED" });
    }

    let buf;
    try {
      buf = Buffer.from(json.bytecode, "base64");
    } catch {
      return send(res, 400, { error: "INVALID_BASE64" });
    }

    let chunk;
    try {
      chunk = parseChunk(buf);
    } catch (e) {
      return send(res, 422, { error: "PARSE_FAILURE", detail: e.message });
    }

    let proto;
    try {
      proto = unshuffleProto(chunk.main, chunk.meta);
    } catch (e) {
      return send(res, 422, { error: "UNSHUFFLE_FAILURE", detail: e.message });
    }

    let disassembly;
    try {
      const lines = disassembleProto(proto);
      disassembly = Array.isArray(lines) ? lines.join("\n") : String(lines);
    } catch (e) {
      return send(res, 422, { error: "DISASSEMBLY_FAILURE", detail: e.message });
    }

    let decompiled;
    try {
      decompiled = decompileProto(proto);
    } catch (e) {
      return send(res, 422, { error: "DECOMPILATION_FAILURE", detail: e.message });
    }

    send(res, 200, { disassembly, decompiled });
  });
});

server.listen(PORT);
