# Analysis 2 für Informatikstudien

12. Übungsblatt

1. Lösen Sie das folgende Anfangswertproblem mithilfe der Laplace-Transformation:

$
y'(t) + 2y(t) = 4 \cos(2t) \text{ mit } y(0) = 1.
$

2. Lösen Sie das folgende Anfangswertproblem mithilfe der Laplace-Transformation:

$
y''(t) - 3y'(t) + 2y(t) = 2e^t \text{ mit } y(0) = 1, y'(0) = 0.
$

3. Ein gedämpftes Schwingungssystem wird zum Zeitpunkt $t = 1$ von einem kurzen, harten Stoß (modelliert durch die Dirac-Delta-Distribution $\delta(t - 1))$ getroffen. Dieses System gehorcht der Differentialgleichung:

$
y''(t) + 2y'(t) + 2y(t) = \delta(t - 1) \text{ mit } y(0) = 0, y'(0) = 0.
$

Bestimmen Sie die Auslenkung $y(t)$ des Pendels mithilfe der Laplace-Transformation. Skizzieren Sie die Lösungskurve, und erklären Sie was sie bedeutet.

Hinweis: Die Laplace-Transformierte von $\delta(t - a)$ ist $e^{-as}.$ Für die Rücktransformation müssen Sie den Verschiebungssatz (oberste Formel auf S. 84 im Skriptum) verwenden. Kontext: Die Laplace-Transformierte der Heaviside-Sprungfunktion$H(t-b)$ist $\frac{e^{-bs}}{s} .$ Dabei ist $H(t - b) = \begin{cases} 1 & \text{für} t \geq b \\ 0 & \text{für} t < b. \end{cases}$

Die Dirac-Distribution ist eine Art „Ableitung“ der (nicht im klassischen Sinn differenzierbaren) Heaviside-Funktion.

4. Bestimmen Sie die Lösung des folgenden inhomogenen Differentialgleichungssystems 1. Ordnung mit konstanten Koeffizienten:

$
\vec{y}'(t) = \begin{pmatrix} 1 & 2 \\ 2 & 1 \end{pmatrix} \vec{y}(t) + \begin{pmatrix} e^{2t} \\ 0 \end{pmatrix} \mathrm{mit} \vec{y}(0) = \begin{pmatrix} 1 \\ -1 \end{pmatrix}.
$

5. Bestimmen Sie die Lösung des folgenden inhomogenen Differentialgleichungssystems 1. Ordnung: $\vec{y}'(t) = \begin{pmatrix} 0 & -2 \\ 2 & 0 \end{pmatrix} \vec{y}(t) + \begin{pmatrix} \sin(t) \\ 0 \end{pmatrix} \mathrm{mit} \vec{y}(0) = \begin{pmatrix} 0 \\ 1 \end{pmatrix}.$

6. Gegeben ist das nichtlineare System:

    $
    y'_1(t) = y_1(1 - y_1 - y_2), y'_2(t) = y_2(2 - y_1 - 2y_2).
    $

    1. Bestimmen Sie alle (drei) Fixpunkte (Ruhelagen) dieses Systems.

    2. Linearisieren Sie das System in den Fixpunkten und bestimmen Sie jeweils mithilfe von Satz 5.1 im Skriptum den Typ des Fixpunkts. (Für jene beiden Fälle in denen der Satz eine Aussage trifft - für einen Fixpunkt können wir mit unseren Methoden den Typ nicht bestimmen.)

Richtig oder Falsch? Geben Sie eine kurze Begründung oder ein Gegenbeispiel an.

- Wenn alle Eigenwerte einer Systemmatrix $A$ einen negativen Realteil besitzen, dann ist die Ruhelage $\vec{y}^∗ =\vec{0}$ des Systems $\vec{y}' = A\vec{y}$ asymptotisch stabil.

- Die Laplace-Transformation ist ein linearer Operator, d.h$. L\{\alpha f+\beta g\} = \alpha L\{f\}+\beta L\{g\}.$

- Wenn die Determinante einer Matrix $A$ positiv ist $(\det(A) > 0),$ dann kann der Ursprung für das System $\vec{y}' = A\vec{y}$ kein Sattelpunkt sein.

- Das Produkt zweier Laplace-transformierter Funktionen im Bildraum entspricht dem Produkt der beiden Funktionen im Zeitraum, also $L^{-1}\{F(s) \cdot G(s)\} = f(t) \cdot g(t).$

Bonusaufgaben für schlaue Füchse:

1. Finden Sie die Lösung von Beispiel 3 mit „klassischen“ Methoden (ohne Laplace-Transformation zu verwenden). Zuerst muss man versuchen, die Fragestellung überhaupt sinnvoll zu stellen, ohne die Dirac-Distribution zur Verfügung zu haben.

2. Klassifizieren Sie in Beispiel 6 auch den Typ jenes Fixpunkts, den wir mit unseren Methoden eigentlich nicht bestimmen können.
