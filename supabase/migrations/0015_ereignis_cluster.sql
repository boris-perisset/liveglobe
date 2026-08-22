-- Globe News – 0015 ist überholt und tut absichtlich nichts
--
-- Diese Migration hat Ereignisse räumlich gestapelt und die Karte damit auf
-- jeder Zoomstufe Ereignisse zeigen lassen. Der Ansatz war falsch:
--
-- Ereignisse sind dünn gestreut. Zwei in derselben groben Rasterzelle — eines
-- auf Korsika, eines in Rom — ergaben eine Bubble auf ihrem Mittelwert, also
-- im Tyrrhenischen Meer. Wer sie anklickte, landete an einem Ort, den es nicht
-- gibt.
--
-- **0016 stellt es richtig:** Die Karte bleibt bei Ortsclustern, positioniert
-- sie auf dem stärksten *echten* Ort einer Zelle statt auf einem Mittelwert,
-- und Ereignisse erscheinen erst nach einem Klick.
--
-- Der Inhalt steht bewusst nicht mehr hier. Eine Migration, die man nicht
-- ausführen soll, aber ausführen kann, ist eine Falle — besonders für jemanden,
-- der die Dateien der Reihe nach durchgeht. Die Nummer bleibt, damit die
-- Reihenfolge lückenlos ist.

select 'Migration 0015 ist überholt. Weiter mit 0016.' as hinweis;
