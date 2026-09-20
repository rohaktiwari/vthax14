import { useCenterView } from "../context/CenterViewContext";
import { BTN_PRIMARY_LG, CARD } from "../lib/ui";
import DemoPicker from "./DemoPicker";
import HeroPanel from "./HeroPanel";

/** Center view while no courses are selected: one clear first step and two demo weeks. */
export default function Welcome() {
  const { showAdd } = useCenterView();

  return (
    <div className="space-y-5">
      <HeroPanel />
      <section aria-label="Get started" className={`${CARD} space-y-5 p-6`}>
        <div>
          <h2 className="text-2xl font-bold text-ink-primary">Plan a week you can actually walk</h2>
          <p className="mt-2 text-base text-ink-secondary">
            Pick your courses. HokieLens shows how risky each one is, how long the walks between classes
            take, and how the whole week fits together.
          </p>
        </div>
        <button type="button" onClick={showAdd} className={BTN_PRIMARY_LG}>
          Search for a course
        </button>
        <div className="border-t border-line pt-4">
          <DemoPicker title="Or try a demo week" />
        </div>
      </section>
    </div>
  );
}
