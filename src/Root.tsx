import { useEffect, useState } from "react";
import App from "./App";
import AcademicApp from "./AcademicApp";
export default function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  const academic = hash.startsWith("#/exam");
  useEffect(() => {
    document.title = academic
      ? "2026 TTRA｜檢定學科成績"
      : "2026 TTRA｜主題挑戰賽即時成績";
  }, [academic]);
  return academic ? (
    <AcademicApp staffView={hash.endsWith("/staff")} />
  ) : (
    <App />
  );
}
