const fail = code => {
  const e = new Error(code);
  e.code = code;
  throw e;
};

const state = () => ({
  regs: {},
  out: []
});

const set = (s, r, v) => {
  s.regs[r] = v;
};

const get = (s, r) => {
  return s.regs[r] || ("r" + r);
};

const emit = (s, v) => {
  s.out.push(v);
};

const handle = {
  loadConst: (s, i, proto) => {
    set(s, i.a, JSON.stringify(proto.constants[i.bx]));
  },
  move: (s, i) => {
    set(s, i.a, get(s, i.b));
  },
  call: (s, i) => {
    emit(s, get(s, i.a) + "()");
  },
  ret: (s, i) => {
    emit(s, "return " + get(s, i.a));
  }
};

const decompileProto = proto => {
  if (!proto || !proto.instructions) fail("INVALID_PROTO");
  if (!proto.opcodeMap) fail("MISSING_OPCODE_MAP");
  const s = state();
  for (let idx = 0; idx < proto.instructions.length; idx++) {
    const i = proto.instructions[idx];
    const def = proto.opcodeMap[i.opcode];
    if (!def) fail("UNKNOWN_OPCODE");
    if (def.flags.loadConst) handle.loadConst(s, i, proto);
    else if (def.flags.move) handle.move(s, i);
    else if (def.flags.call) handle.call(s, i);
    else if (def.flags.ret) handle.ret(s, i);
  }
  return s.out.join("\n");
};

module.exports = { decompileProto };
