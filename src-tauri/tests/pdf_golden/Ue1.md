## Diskrete Mathematik für Informatikstudien

## Sommersemester 2026

                            1. Übungsblatt (10.3.2026)

Beispiel 1.1. Zu den Aussagen $A, B$ betrachten wir die verknüpften Aussagen (Formeln)

$
X_1 = A \to B Y_1 = \neg A \to \neg B Z_1 = \neg A \vee B
$

$
X_2 = B \to A Y_2 = X_1 \wedge X_2 Z_2 = A \leftrightarrow B
$

Erstellen Sie eine Wahrheitstafel für die Formeln $X_1, Y_1, Z_1, X_2, Y_2, Z_2$ und lesen Sie daraus ab, welche der Formeln zueinander logisch äquivalent sind. Beispiel 1.2. Zu Aussagen $A, B$ betrachten wir die verknüpften Aussagen (Formeln)

$
X = A\dot{\vee} B \text{ und } Y = A \wedge B.
$

Weisen Sie anhand von Wahrheitstafeln nach, dass $X\wedge Y$ stets eine falsche Aussage und $X\vee Y$ logisch äquivalent zu $A \vee B$ ist. Folgern Sie daraus, dass für Mengen $M, N$ die verknüpften Mengen $M\triangle N$ und $M \cap N$ immer disjunkt sind und

$
(M\triangle N) \cup (M \cap N) = M \cup N
$

erfüllen. Beispiel 1.3. Welche der Aussagen

$
\forall x \in \mathbb{N} \exists y \in \mathbb{Z}: x > y, \exists x \in \mathbb{N} \forall y \in \mathbb{Z}: x > y, \forall x \in \mathbb{Z} \exists y \in \mathbb{N}: x > y, \exists x \in \mathbb{Z} \forall y \in \mathbb{N}: x > y
$

sind wahr und welche sind falsch? Begründen Sie jeweils Ihre Antwort. Beispiel 1.4. Für jede Zahl $k \in \mathbb{N}$ betrachten wir die Menge $M_k = \{x \in \mathbb{Z} | x$ ist durch $k$ teilbar$\}.$ Stellen Sie die Mengen $M_2 \cap M_5, M_2 \cap M_6, M_6 \cap M_{10}, M_2 \cup M_5$ und $M_3 \cup M_6$ jeweils in der Schreibweise $\{x \in \mathbb{Z} | \cdot \cdot \cdot \}$ dar und vereinfachen Sie die Schreibweise so weit wie möglich. Beispiel 1.5. Die Formel

$
1 + 2 + 3 + \cdot \cdot \cdot + n = \frac{n(n + 1)}{2} \tag{1}
$

lässt sich auch ohne Verwendung vollständiger Induktion nachweisen: Man schreibt

$
2(1 + 2 + 3 + \cdot \cdot \cdot + n) = \text{ 1 + 2 + } 3 + \cdot \cdot \cdot + n + n + (n - 1) + (n - 2) + \cdot \cdot \cdot + 1
$

und bemerkt, dass die untereinander stehenden Summanden zusammen jeweils $n+ 1$ ergeben. Weil es $n$ solche Paare gibt, ist $2(1 + 2 + 3 + \cdot \cdot \cdot + n) = n(n + 1)$ und (1) folgt, indem man durch 2 dividiert. Berechnen Sie mit Hilfe dieser Methode für $n \in \mathbb{N}$ die Werte der Summen $1 + 3 + 5 + \cdot \cdot \cdot + (2n - 1)$ (die ersten $n$ ungeraden Zahlen), $3 + 13 + 23 + \cdot \cdot \cdot + (10(n - 1) + 3)$ (die ersten $n$ Zahlen, die mit Ziffer 3 enden).
