import Screen from "./screen";

// Reads project data from browser storage, so it can't be prerendered.
export const instant = false;

export default function Page() {
  return <Screen />;
}
