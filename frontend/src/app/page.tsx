/**
 * Root page – renders the main game view.
 *
 * This is a Server Component wrapper; the actual interactive content lives
 * in `GameView` which is a Client Component.  Keeping the page file as a
 * Server Component allows Next.js to generate correct metadata and avoids
 * unnecessary client bundle bloat at the page level.
 */

import { GameView } from "@/components/game/GameView";

export default function HomePage() {
  return <GameView />;
}
