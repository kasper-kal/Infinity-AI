# What's Next

## Last session (2026-08-11)

**User message:** "start with splitting home.tsx (2000 lines is way too much for one file) and finish the nl (dutch) i18n gaps" (+ "resume")

**What I did:**
- Split `home.tsx` (2000 → 1520 lines) by extracting 7 presentational components into `src/components/home/`: KeyRetryBanner, HomeHeader, CameraModeView, VoiceModeView, ChatModeView, ChatComposer, PipBrowserWindow. All logic/state/handlers stay in Home (matches the existing useChatStream pattern). Consolidated the duplicated `AttachedFile` interface into `@/types/widget.ts`.
- Finished the Dutch i18n gaps: added 15 new keys to both `en` and `nl` and routed every previously-hardcoded string in the new components through `t()` (key-retry banner, header history label, camera detection note, voice YOU/JARVIS, composer FILE ATTACHED / +-menu title / agent-mode indicator / attachment alt).
- `tsc --noEmit` passes clean (EXIT 0); final sweep found no remaining hardcoded UI strings in the new components.

**My response:** Both requested tasks are complete and typecheck clean. Files changed: 5 new components in `src/components/home/`, `home.tsx`, `i18n.tsx`, `types/widget.ts`, `use-chat-stream.ts`.

## Next steps (awaiting user direction)
- Nothing pending from the current request. Both tasks done.
- Ideas if the user wants to keep going: the extracted components could take a runtime smoke test (npm run dev), and the AppOverlays / use-chat-stream.ts files are large and could be the next decomposition targets.
