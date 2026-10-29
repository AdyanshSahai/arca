// First-run walkthrough, in the spirit of a new computer's setup screens:
// a few calm, full-window steps that set the choices that matter before
// any notes are touched. Whatever is picked here is saved to the config
// (settings.json) and can be changed later in Settings.
//
//   1. Welcome      what Arca is
//   2. Colours      a colour scheme (the app re-themes live behind it)
//   3. Saving       autosave on (default) or off (Ctrl+S)
//   4. History      version history with built-in git, on or off
//   5. Your notes   open a vault folder
//
// Steps slide and fade into each other; Back/Next or ←/→/Enter navigate.

import { ArrowLeft, ArrowRight, Check, FolderOpen, History, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { paletteFor, THEMES } from "../lib/themes";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { pickVault } from "./ActionRail";
import { ArcaMark } from "./ui/ArcaMark";
import { CustomColors } from "./ui/CustomColors";
import { ThemeCard } from "./ui/ThemeCard";

const STEPS = ["welcome", "colours", "saving", "history", "vault"] as const;
type Step = (typeof STEPS)[number];

export function Onboarding() {
  const onboarded = useUi((s) => s.prefs.onboarded);
  if (onboarded) return null;
  return <Walkthrough />;
}

function Walkthrough() {
  const prefs = useUi((s) => s.prefs);
  const setPrefs = useUi((s) => s.setPrefs);
  const vault = useVault((s) => s.info);
  const [index, setIndex] = useState(0);
  /** Direction of the last move, for the slide animation. */
  const [dir, setDir] = useState<1 | -1>(1);
  /** Bumped on every step change to restart the enter animation. */
  const [anim, setAnim] = useState(0);
  const step: Step = STEPS[index];
  // The custom scheme's colours (or the current preset's, to start from).
  const custom = paletteFor("custom", prefs.customColors ?? paletteFor(prefs.theme === "custom" ? "twilight" : prefs.theme));

  const go = (delta: 1 | -1) => {
    const next = index + delta;
    if (next < 0) return;
    if (next >= STEPS.length) return finish();
    setDir(delta);
    setIndex(next);
    setAnim((a) => a + 1);
  };
  const finish = () => setPrefs({ onboarded: true });

  // Keyboard: → / Enter next, ← back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-void">
      {/* Soft glow behind the content, in the current accent colour. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ background: "radial-gradient(60% 50% at 50% 35%, var(--accent-soft), transparent 70%)" }}
      />
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">
        {/* Keyed on `anim` so each step plays its enter animation. */}
        <div key={anim} className={`w-[640px] max-w-full ${dir === 1 ? "onb-enter-right" : "onb-enter-left"}`}>
          {step === "welcome" && (
            <div className="flex flex-col items-center text-center">
              <div className="onb-pop">
                <ArcaMark size={72} />
              </div>
              <h1 className="mt-8 text-[40px] font-bold tracking-tight text-fg">Welcome to Arca</h1>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
                A notebook for deep trees of notes, kept as plain Markdown files on your computer, with links, a
                graph and instant search.
              </p>
              <p className="mt-6 text-[13px] text-muted/70">Let's set a few things up. It takes a minute.</p>
            </div>
          )}

          {step === "colours" && (
            <div>
              <StepTitle title="Pick your colours" subtitle="A preset, or Custom to choose all 8 colours yourself. Change it any time in Settings." />
              <div className="grid grid-cols-4 gap-3">
                {THEMES.map((t) => (
                  <ThemeCard
                    key={t.id}
                    name={t.name}
                    palette={t.palette}
                    selected={prefs.theme === t.id}
                    onClick={() => setPrefs({ theme: t.id })}
                  />
                ))}
                <ThemeCard
                  name="Custom"
                  palette={custom}
                  selected={prefs.theme === "custom"}
                  // Starting a custom scheme copies the current preset's colours.
                  onClick={() => setPrefs({ theme: "custom", customColors: custom })}
                />
              </div>
              {prefs.theme === "custom" && (
                <div className="mt-5 rounded-xl border border-line-strong bg-btn/50 p-4">
                  <CustomColors palette={custom} onChange={(p) => setPrefs({ customColors: p })} />
                </div>
              )}
            </div>
          )}

          {step === "saving" && (
            <div>
              <StepTitle icon={<Save size={22} />} title="How should notes be saved?" />
              <div className="grid gap-3">
                <Option
                  selected={prefs.autosave}
                  onClick={() => setPrefs({ autosave: true })}
                  title="Automatically"
                  badge="Recommended"
                  text="Every note is written to disk about half a second after you stop typing, and whenever you switch away from Arca. You never lose more than a moment of typing."
                />
                <Option
                  selected={!prefs.autosave}
                  onClick={() => setPrefs({ autosave: false })}
                  title="Only when I press Ctrl+S"
                  text="Like a classic editor: changes stay unsaved until you save them, and Arca asks before closing if anything is unsaved."
                />
              </div>
            </div>
          )}

          {step === "history" && (
            <div>
              <StepTitle icon={<History size={22} />} title="Keep a version history?" />
              <div className="grid gap-3">
                <Option
                  selected={prefs.history}
                  onClick={() => setPrefs({ history: true })}
                  title="Yes, keep history"
                  badge="Recommended"
                  text="Every few minutes Arca quietly snapshots your notes with git (built in, nothing to install). Go back to any earlier version in the Time Machine. Uses about 4 MB a year in a hidden folder."
                />
                <Option
                  selected={!prefs.history}
                  onClick={() => setPrefs({ history: false })}
                  title="No history"
                  text="Notes are still saved normally, but there's no way to go back to older versions. Deleted notes can still be restored from the trash."
                />
              </div>
            </div>
          )}

          {step === "vault" && (
            <div className="flex flex-col items-center text-center">
              <div className="onb-pop flex h-16 w-16 items-center justify-center rounded-2xl border border-line-strong bg-btn text-accent">
                {vault ? <Check size={30} /> : <FolderOpen size={28} />}
              </div>
              <h2 className="mt-6 text-[28px] font-bold tracking-tight text-fg">
                {vault ? "You're all set" : "Where are your notes?"}
              </h2>
              <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted">
                {vault
                  ? `Arca will open “${vault.name}”. Folders are chapters; click a chapter's name to write its overview.`
                  : "Pick any folder. An empty one is fine. Arca only reads and writes Markdown files inside it."}
              </p>
              {!vault && (
                <button
                  onClick={() => void pickVault()}
                  className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[14px] font-semibold text-void transition-colors hover:brightness-110"
                >
                  <FolderOpen size={16} /> Open a folder…
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer: back, progress dots, next. */}
      <div className="relative flex items-center justify-between px-10 pb-8">
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg disabled:invisible"
        >
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex gap-2">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-6 bg-accent" : "w-1.5 bg-line-strong"}`}
            />
          ))}
        </div>
        <button
          onClick={() => go(1)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-[13px] font-semibold text-void transition-colors hover:brightness-110"
        >
          {index === STEPS.length - 1 ? (vault ? "Start writing" : "Skip for now") : "Next"} <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function StepTitle({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <div className="mb-6 text-center">
      {icon && <div className="mb-3 flex justify-center text-accent">{icon}</div>}
      <h2 className="text-[26px] font-bold tracking-tight text-fg">{title}</h2>
      {subtitle && <p className="mt-1.5 text-[14px] text-muted">{subtitle}</p>}
    </div>
  );
}

/** A big selectable option card with a radio dot. */
function Option({
  selected,
  onClick,
  title,
  text,
  badge,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  text: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-start gap-4 rounded-xl border p-5 text-left transition-all duration-200 ${
        selected ? "border-accent bg-accent-soft" : "border-line-strong bg-btn/50 hover:border-muted"
      }`}
    >
      <span
        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          selected ? "border-accent" : "border-muted/60"
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span>
        <span className="flex items-center gap-2 text-[15px] font-semibold text-fg">
          {title}
          {badge && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold text-accent">{badge}</span>}
        </span>
        <span className="mt-1 block text-[13px] leading-relaxed text-fg/65">{text}</span>
      </span>
    </button>
  );
}
