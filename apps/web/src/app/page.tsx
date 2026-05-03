import Link from 'next/link';

export default function HomePage() {
  return (
    <section>
      <h1>MDCalc — Take-Home</h1>
      <p>
        Available calculators — pick one to get started. The HEART Score is the one
        you are asked to implement in this assignment.
      </p>
      <ul>
        <li>
          <Link href="/calculators/heart-score">HEART Score for Major Cardiac Events</Link>
        </li>
      </ul>
    </section>
  );
}
