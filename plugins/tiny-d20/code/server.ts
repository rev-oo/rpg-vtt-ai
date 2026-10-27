// tiny-d20's server code (specs §8.10): the `/check` slash command, packed by `vtt-plugin pack`.
import { defineServer } from '@vtt/sdk';

const ABILITIES: Readonly<Record<string, string>> = { str: 'Strength', dex: 'Dexterity' };

export default defineServer({
  commands: {
    /** `/check str` or `/check dex`: an ability check for the actor the member speaks as. */
    check: async ({ ctx, actor, args }) => {
      const ability = args.trim().toLowerCase();
      const name = Object.hasOwn(ABILITIES, ability) ? ABILITIES[ability] : undefined;
      if (!name) return ctx.fail('Use /check str or /check dex.');
      if (!actor) return ctx.fail('Speak as a character to use /check.');
      const roll = await ctx.roll(`1d20 + @derived.${ability}Mod`);
      await ctx.chat.post({ text: `${actor.name}: ${name} check`, rolls: [roll] });
    },
  },
});
