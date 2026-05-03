import { HeartScoreCalculator } from '@/components/calculators/heart-score/HeartScoreCalculator';
import { RecentCalculations } from '@/components/calculators/heart-score/RecentCalculations';

export const metadata = {
  title: 'HEART Score for Major Cardiac Events — MDCalc',
};

export default function HeartScorePage() {
  return (
    <section style={{ display: 'grid', gap: '2rem' }}>
      <header>
        <h1>HEART Score for Major Cardiac Events</h1>
        <p>
          Predicts 6-week risk of major adverse cardiac events (MACE) in patients
          presenting with chest pain. Use alongside clinical judgment — this tool
          does not replace it.
        </p>
      </header>

      {/* TODO(candidate): ensure the form is accessible and keyboard-friendly.  */}
      <HeartScoreCalculator />

      <RecentCalculations />
    </section>
  );
}
