// Plain ESM, as `vtt-plugin pack` emits it: the SDK's defineServer only returns its argument.
export default {
  handlers: {
    strike: async ({ ctx, actor }) => {
      const hit = await ctx.roll('1d1 + @derived.mod');
      await ctx.chat.post({ text: `${actor.name} strikes`, rolls: [hit] });
    },
  },
};
