const fail = code => {
  const e = new Error(code);
  e.code = code;
  throw e;
};

const normalizeLua51 = (proto, meta) => {
  return proto;
};

const normalizeLuau = (proto, meta) => {
  return proto;
};

const unshuffleProto = (proto, meta) => {
  if (!proto || !meta) fail("INVALID_PROTO");
  if (meta.format === "lua51") return normalizeLua51(proto, meta);
  if (meta.format === "luau") return normalizeLuau(proto, meta);
  fail("UNSUPPORTED_FORMAT");
};

module.exports = { unshuffleProto };
