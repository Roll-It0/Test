const detect = buffer => {
  if (buffer[0] === 0x1B && buffer[1] === 0x4C && buffer[2] === 0x75 && buffer[3] === 0x61) return "lua51";
  if (buffer[0] === 0x1B && buffer[1] === 0x4C && buffer[2] === 0x75 && buffer[3] === 0x61) return "lua51";
  return "luau";
};

const fail = code => {
  const e = new Error(code);
  e.code = code;
  throw e;
};

const parseLua51 = buffer => {
  return {
    meta: { format: "lua51" },
    main: {
      instructions: [],
      constants: [],
      protos: []
    }
  };
};

const parseLuau = buffer => {
  return {
    meta: { format: "luau" },
    main: {
      instructions: [],
      constants: [],
      protos: []
    }
  };
};

const parseChunk = buffer => {
  if (!Buffer.isBuffer(buffer)) fail("INVALID_BUFFER");
  const format = detect(buffer);
  if (format === "lua51") return parseLua51(buffer);
  if (format === "luau") return parseLuau(buffer);
  fail("UNKNOWN_FORMAT");
};

module.exports = { parseChunk };
