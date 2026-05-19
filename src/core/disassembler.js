const fail = code => {
  const e = new Error(code);
  e.code = code;
  throw e;
};

const formatABC = (i, name) => name + " " + i.a + " " + i.b + " " + i.c;
const formatABx = (i, name) => name + " " + i.a + " " + i.bx;
const formatAsBx = (i, name) => name + " " + i.a + " " + i.sbx;
const formatAx = (i, name) => name + " " + i.ax;

const formatters = {
  ABC: formatABC,
  ABx: formatABx,
  AsBx: formatAsBx,
  Ax: formatAx
};

const disassembleInstruction = (i, table) => {
  const def = table[i.opcode];
  if (!def) fail("UNKNOWN_OPCODE");
  const f = formatters[def.shape];
  if (!f) fail("INVALID_SHAPE");
  return f(i, def.name);
};

const disassembleProto = proto => {
  if (!proto || !proto.instructions) fail("INVALID_PROTO");
  const table = proto.opcodeMap;
  if (!table) fail("MISSING_OPCODE_MAP");
  const out = [];
  for (let idx = 0; idx < proto.instructions.length; idx++) {
    const ins = proto.instructions[idx];
    out.push(disassembleInstruction(ins, table));
  }
  return out;
};

module.exports = { disassembleProto };
