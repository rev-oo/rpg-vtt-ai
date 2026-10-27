// Plain ESM, as `vtt-plugin pack` emits it: the SDK's defineShared only returns its argument.
export default {
  functions: {
    half: (x) => (typeof x === 'number' ? Math.floor(x / 2) : 0),
  },
};
