## Diskrete Mathematik für Informatikstudien

## Sommersemester 2026

                        9. Übungsblatt (19.5.2026)

Beispiel 9.1. Bringen Sie die folgenden Formeln in pränexe Normalform. Halten Sie dabei die Anzahl der verwendeten Variablen möglichst klein.

$
(( ) ( ))
$

1. $\neg\forall y \exists xP(x, y) \to \forall z\neg \exists xQ(x, y, z)$ .

$
( )
$

2. $\forall x \exists y\forall zR(x, y, z) \vee \neg\forall z\exists y\neg R(x, y, z) .$

Beispiel 9.2. Gegeben sind $a, b, c, k, n \in \mathbb{N}_0.$

3. Vor den Hörsälen A, B und C befinden sich $a + b + c$ Studierende. Von diesen gehen $a$ Studierende in den Hörsaal A$, b$ Studierende in Hörsaal B und $c$ Studierende in Hörsaal C. Argumentieren Sie ohne Ausrechnen der Formeln, dass sich die Anzahl der Möglichkeiten hierfür sowohl als

$
( )( ) ( )( ) a + b + c b + c a + b + c a + c
$

als auch als

$
a b b c
$

darstellen lässt. Rechnen Sie anschließend anhand der Formel für Binomialkoeffizienten nach, dass beide Ausdrücke die gleiche Zahl liefern.

4. In einer Lotterie $k$ aus $n + 1“$ werden von $n + 1$ nummerierten Kugeln $k$ gezogen. ” Die Reihenfolge dieser $k$ Kugeln ist dabei egal. Außerdem wird eine weitere Kugel als Zusatzzahl“ gezogen (hierfür nehmen wir offensichtlich $k+1 \leq n+1$ an). Argumentieren ” Sie ohne Ausrechnen der Formeln, dass man die Anzahl der möglichen Ergebnisse einer Lottoziehung auf die folgenden drei Arten darstellen kann.

$
( ) ( ) ( ) n + 1 n n + 1 (n - k + 1), (n + 1) \text{ und } (k + 1). k k k + 1
$

Rechnen Sie anschließend nach, dass alle drei Ausdrücke die gleiche Zahl liefern.

Beispiel 9.3. Eine wichtige Methode in der Kombinatorik ist das *Prinzip* *von* *Inklusion* *und* *Exklusion* (oder kurz *Inklusion-Exklusion*), welches wie folgt formuliert werden kann. Für gegebene Mengen $A_1, . . . , A_n$ gilt

$
  \sum^n  \sum \    |A_1 \cup \cdot \cdot \cdot \cup A_n| = (-1)^{k+1} A_i .
$

$
k=1 I\subseteq\{1,...,n\} i\in I |I|=k
$

In Worten: Man erhält die Kardinalität der Vereinigung von $A_1, . . . , A_n,$ indem man die Kardinalitäten aller einzelnen Mengen addiert, davon alle Kardinalitäten von Durchschnitten zweier dieser Mengen subtrahiert, dann alle Kardinalitäten von Durchschnitten dreier dieser Mengen addiert und so weiter. In einer Permutation von $\{1, . . . , n\}$ wird eine Zahl $i \in \{1, . . . , n\}$ *Fixpunkt* genannt, wenn sie in der Permutation an Position $i$ vorkommt. Wir bezeichnen mit $A_i$ die Menge der Permutationen, für die $i$ ein Fixpunkt ist. Wenden Sie Inklusion-Exklusion an, um die Anzahl aller Permutationen von $\{1, . . . , n\}$ zu berechnen, die keinerlei Fixpunkte haben.

1

Beispiel 9.4. Für einen Wettbewerb mit $n = 2^k$ teilnehmenden Teams $(k \in \mathbb{N})$ soll ausgelost werden, welche Teams gegeneinander antreten. Dabei soll *nicht* zwischen Reihenfolgen innerhalb der einzelnen Partien unterschieden werden (d.h$. A$ gegen $B“$ ist das gleiche Spiel wie ” $B$ gegen $A“)$ und ebenso nicht zwischen verschiedenen Reihenfolgen der Partien innerhalb ” einer Runde (d.h. wenn bei vier Teams $A$ gegen $B$ und $C$ gegen $D$ spielen, ist es egal, welche dieser Partien als erstes und welche als zweites Spiel betrachtet wird).

1. In der ersten Runde tritt jedes Team gegen genau ein anderes Team an. Bestimmen Sie die Anzahl der möglichen Auslosungen für diese Runde. Es gibt dabei keinerlei Einschränkungen, welche Teams aufeinander treffen können.

Die in der ersten Runde siegreichen Teams erreichen die zweite Runde, in der wiederum jedes Team gegen genau ein anderes antritt etc., bis im Finale die letzten beiden verbleibenden Teams gegeneinander spielen.

2. Für $n = 2^7 = 128$ gibt es 32 gesetzte Teams $G_1, . . . , G_{32}.$ Das Turnier soll derart ablaufen, dass $G_1$ und $G_2$ nicht vor dem Finale aufeinander treffen können$, G_1, . . . , G_4$ nicht vor dem Halbfinale$, G_1, . . . , G_8$ nicht vor dem Viertelfinale und so weiter. Ermitteln Sie die Anzahl der möglichen Auslosungen für das komplette Turnier. *Anmerkung.* Ein ähnliches System wird im Tennis bei den Grand Slam“ Turnieren ” verwendet.

Beispiel 9.5. Es soll ein Passwort mit genau 8 Zeichen gewählt werden, wobei nur die 26 Großbuchstaben, 26 Kleinbuchstaben und die Ziffern von 0 bis 9 als Zeichen erlaubt sind. Wie viele Möglichkeiten für solch ein Passwort gibt es, wenn

3. es keinerlei weitere Einschränkungen gibt, welche Zeichen vorkommen;

4. genau drei Großbuchstaben, vier Kleinbuchstaben und eine Ziffer vorkommen sollen (dabei darf der gleiche Groß-/Kleinbuchstabe mehrfach verwendet werden);

5. jeweils mindestens ein Großbuchstabe, ein Kleinbuchstabe und eine Ziffer vorkommen sollen?
