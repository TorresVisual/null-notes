# Analysis 2 für Informatikstudien

5. Übungsblatt

1. Ein Bauteil hat die Form eines Zylinders $K$ mit Radius $R = 2$ und Länge $L = 3.$ Der Zylinder liegt so im Koordinatensystem, dass seine Symmetrieachse auf der $y-$Achse liegt $(0 \leq y \leq 3).$ Die Grundfläche liegt in der $xz-$Ebene $(y = 0).$ Die Dichte des Materials ist inhomogen und wird durch die Funktion $\rho(x, y, z) = y + 1$ beschrieben.

    1. Berechnen Sie die Gesamtmasse $M$ des Bauteils mittels des Dreifachintegrals:

    $
    M = \iiint_{K} (y + 1)dxdydz.
    $

    2. Bestimmen Sie die $y-$Koordinate des Massenschwerpunkts $y_S$ mithilfe der Formel:

    $
    \int \int \int
    $

    1

    $
    y_S = y \cdot \rho(x, y, z)dxdydz M K
    $

    3. Argumentieren (oder berechnen) Sie, warum für die anderen Koordinaten des Schwerpunkts $x_S = 0$ und $z_S = 0$ gelten muss.

2. Ein Körper $K$ hat die Form eines Kugelsektors (ähnlich einer Eistüte mit Eiskugel drauf). Er wird beschrieben durch den Radius $0 \leq r \leq 3$ und den Polarwinkel $0 \leq \theta \leq \frac{\pi}{4}$ (entspricht $45^{\circ}$ zur $z-$Achse). Die Dichte des Körpers ist proportional zum Abstand vom$\sqrt{_2}$ 2 2

    $
    \text{Ursprung} : \rho(x, y, z) = x + y + z .
    $

    1. Berechnen Sie die Gesamtmasse des Körpers $K$ mittels des Dreifachintegrals:

    $
    M = \iiint_{K} \rho dxdydz
    $

    2. Berechnen Sie auch die Masse für eine volle Kugel mit Radius $R = 3$ und derselben Dichte $\rho.$ Wie groß ist die Masse des Kugelsektors im Vergleich zur Gesamtmasse?

3. Gegeben ist das Vektorfeld $\vec{v}(x, y) = \begin{pmatrix} x + y \\ x - y \end{pmatrix}.$

    $
    \int_C
    $

    Berechnen Sie das Kurvenintegral $\vec{v} \cdot d\vec{x}$ entlang der folgenden Wege von $A = (0,0)$ nach $B = (1,1):$

    1. $C_1:$ Die direkte Verbindungsstrecke.

    2. $C_2:$ Der Weg entlang der Parabel $y = x^2.$

    3. Überprüfen Sie mittels der Integrabilitätsbedingung dass das Feld ein Gradientenfeld ist, und zeigen Sie wie man die Ergebnisse aus Teilaufgabe (a) und (b) auch nach dem Prinzip “Kurvenintegral = Potenzialdifferenz” berechnen kann.

1

4. Gegeben ist das Vektorfeld

    $
    \vec{v}(x, y) = \begin{pmatrix} ye^{xy} + \sin(y) + 2x \\ xe^{xy} + x\cos(y) + \sin(y) + y\cos(y) \end{pmatrix}.
    $

    Zudem ist ein Weg $C$ durch die folgende Parametrisierung gegeben:

    $
    \vec{x}(t) = \begin{pmatrix} t^2\cos(^{\pi}_2t) + t \\ \sqrt{} \\ \pi te^{t-1} \end{pmatrix}, t \in [0,1].
    $

    1. Zeigen Sie mittels der Integrabilitätsbedingung, dass $\vec{v}$ ein Gradientenfeld auf $\mathbb{R}^2$ ist.

    2. Bestimmen Sie die zugehörige Potenzialfunktion $\Phi(x, y).$

    $
    \int_C
    $

    3. Berechnen Sie mithilfe der Potenzialfunktion den Wert des Kurvenintegrals $\vec{v}\cdot d\vec{x}.$

Richtig oder Falsch? Geben Sie eine kurze Begründung oder ein Gegenbeispiel an.

- Das Volumen einer Kugel mit Radius $R$ berechnet sich in Kugelkoordinaten durch das

$
\int_R\int_{2\pi} \int_{\pi} \text{Integral 0 0 } _0 r^2\sin(\theta)d\theta d\varphi dr.
$

- Jedes (stetig differenzierbare) Vektorfeld besitzt ein Potenzial.

- Zu jeder (stetig differenzierbaren) Potenzialfunktion gehört ein Vektorfeld.

- Verschiedene Gradientenfelder haben verschiedene Potenziale.

- In einem Gradientenfeld ist das Kurvenintegral entlang jeder geschlossenen Kurve $C$ immer gleich Null.

- Ein Vektorfeld $\vec{v}$ besitzt genau dann ein Potenzial, wenn seine Divergenz überall gleich Null ist.

Bonus-Aufgabe für Mathematik-Masochisten: Versuchen Sie, den Körper $K ($den Kugelsektor) aus Aufgabe 2 ausschließlich in kartesischen

$
\int\int\int
$

Koordinaten $(x, y, z)$ zu beschreiben, und das Dreifachintegral $_K \rho dxdydz$ in kartesischen Koordinaten zu berechnen.1

Bonus-Aufgabe für Mathematik-Masochisten II: Versuchen Sie das Kurvenintegral in Beispiel 4(c) direkt anhand der Parametrisierung zu berechnen, ohne das Potenzial zu verwenden.2

1Das sollte prinzipiell möglich sein, ich schätze man braucht ca. 5-10 Blatt Papier. 2Nein, nicht wirklich — das ist de facto unmöglich, und zwar nicht nur für einen Menschen, sondern auch für eine symbolische Computeralgebra-Software. 2
