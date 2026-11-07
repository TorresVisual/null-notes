# Analysis 2 für Informatikstudien

10. Übungsblatt

1. Teilen Sie die folgenden Funktionen $f : \mathbb{C} \to \mathbb{C}$ in Real- und Imaginärteil, also

    $
    f(z) = f(x + iy) = u(x, y) + i \cdot v(x, y).
    $

    1. $f(z) = z^3.$

    2. $f(z) = e^{iz}.$

    3. $f(z) =\bar{ }z.$

    4. $f(z) = |z|.$

        1. $f(z) = \frac{1}{z} , z ̸= 0.$

    5. $f(z) = \sin(z).$

(Erinnerung $1: \bar{z}$ ist die zu $z$ konjugiert komplexe Zahl. Erinnerung 2: per Definition ist

$
\sin z := ^{e^{iz}-e^{-iz}}_{2i} \text{ .)}
$

2. Verwenden Sie die Cauchy�Riemannschen Differentialgleichungen, um die Funktionen aus Aufgabe 1 auf Holomorphie zu überprüfen.

3. Berechnen Sie das komplexe Kurvenintegral

    $
    \int_C 6z^2 - 2iz dz
    $

    entlang der geraden Verbindungsstrecke $C$ vom Startpunkt $z_0 = 1$ zum Endpunkt $z_1 =$ $2 - 2i$ auf drei verschiedene Arten:

    1. Indem Sie die Funktion $f(z) = f(x+iy)$ in Realteil $u(x, y)$ und Imaginärteil $v(x, y)$ zerlegen und das Integral mithilfe zweier reeller Kurvenintegrale zweiter Art über die Formel $\int$ $\int$ $\int$

    $
    f(z)dz = (u dx - v dy) + i (v dx + u dy) C C C
    $

    berechnen.

    2. Indem Sie den Weg in der komplexen Zahlenebene als $z(t)$ parametrisieren und das

    $
    \int_b
    $

    Integral direkt über die Definition $_a f(z(t)) \cdot z'(t)dt$ berechnen.

    $
    \int
    $

    3. Indem Sie die Stammfunktion $F(z) =$ $f(z)dz$ bestimmen und das Integral als „Stammfunktion am Endpunkt minus Stammfunktion am Anfangspunkt“ berechnen.

4. Gegeben sei die Funktion $u : \mathbb{R}^2 \to \mathbb{R}$ mit

    $
    u(x, y) = x^3 - 3xy^2 + 4xy + x.
    $

    1. Zeigen Sie, dass $u$ eine harmonische Funktion ist, indem Sie nachweisen, dass sie die Laplace-Gleichung $∆u = 0$ erfüllt.

1

1. Bestimmen Sie die zu $u$ harmonisch konjugierte Funktion $v(x, y),$ so dass die komplexe Funktion $f(x + iy) = u(x, y) + i \cdot v(x, y)$ auf ganz $\mathbb{C}$ holomorph ist.

2. Stellen Sie die Funktion $f(x + iy)$ als Funktion $f(z)$ in der komplexen Variable $z$ dar.1

5. Berechnen Sie mithilfe der Cauchy-Integralformel das komplexe Kurvenintegral

$
\int_C \frac{e^z}{z - 2} dz
$

entlang des einmal mathematisch positiv durchlaufenen Kreises $C$ mit Radius $R = 3$ und Mittelpunkt im Ursprung.

Richtig oder Falsch? Geben Sie eine kurze Begründung oder ein Gegenbeispiel an. Alle Fragen beziehen sich auf Funktionen und Kurvenintegrale in der komplexen Zahlenebene $\mathbb{C}.$

- Wenn für eine Funktion $f : \mathbb{C} \to \mathbb{C}$ sowohl der Real- als auch der Imaginärteil stetig differenzierbar sind, dann ist die Funktion holomorph.

- Für jede auf ganz $\mathbb{C}$ holomorphe Funktion $f$ und jede geschlossene Kurve $C$ gilt nach dem

$
\oint_C
$

Cauchy-Integralsatz stets $f(z)dz = 0.$

$
\oint_C
$

- Das komplexe Kurvenintegral $\frac{1}{z} dz$ entlang eines mathematisch positiv durchlaufenen Kreises $C$ um den Ursprung hängt vom Radius des Kreises ab.

- Wenn zwei holomorphe Funktionen $f$ und $g$ auf einem Gebiet denselben Realteil besitzen, dann haben sie auch denselben Imaginärteil (bis auf Addition einer Konstanten).

- Besitzt eine Funktion $f$ an der Stelle $z_0$ eine Singularität (ist dort also nicht holomorph),

$
\oint_C
$

so ist das Integral $f(z)dz$ entlang einer geschlossenen Kurve um $z_0$ niemals Null.

Bonusaufgabe für Mathematik-Masochisten: Berechnen Sie das reelle Integral

$
\int_{2\pi} ( ) e^{\cos(\theta)}\cos \theta + \sin(\theta) d\theta.
$

0

$
\oint_C
$

Hinweis: Betrachten Sie das komplexe Kurvenintegral $e^z dz$ entlang des Einheitskreises $C,$ und teilen Sie es in Real- und Imaginärteil. Nutzen Sie den Cauchy-Integralsatz. 1Das macht man mit dem sogenannten Permanenzprinzip für holomorphe Funktionen. An einem Beispiel: angenommen, man hat eine holomorphe Funktion $g$ mit Real- und Imaginärteil dargestellt, etwa $g(x, y) =$ $e^x\sin(y) +i\cdot e^x\cos(y).$ Man setzt jetzt $y = 0$ und erhält $g(x,0) = e^x\sin(0) +ie^x\cos(0) = ie^x.$ Laut Permanenzprinzip darf man jetzt die Variable $x$ durch $z$ ersetzen und erhält die korrekte Darstellung von $g$ in der Variable $z,$ nämlich $g(z) = ie^z.$ Dass das wirklich funktioniert hat kann man überprüfen indem man das Ergebnis, also $ie^z,$ wieder in Real- und Imaginärteil auftrennt. 2
