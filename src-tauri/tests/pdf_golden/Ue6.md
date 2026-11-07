## Diskrete Mathematik für Informatikstudien

## Sommersemester 2026

                            6. Übungsblatt (28.4.2026)

*Auf* *diesem* *Blatt* *müssen* *an* *mehreren* *Stellen* *die* *Werte* *von* *Schlüsseln/Parametern* *be-* *rechnet* *werden.* *Falls* *mehrere* *Werte* *in* *Frage* *kommen,* *wählen* *Sie* *jeweils* *den* *kleinsten* *positiven* *Wert* *für* *Ihr* *Ergebnis.*

Beispiel 6.1. Ermitteln Sie ohne elektronische Hilfe $a, b \in \{0,1, . . . ,124\}$ und $c \in \{0,1, . . . ,7\},$ für die

$2026^{2804} \equiv a$ mod $125,$ 2026(517932804) $\equiv b$ mod 125 und 2026(517932804) $\equiv c$ mod 8

gilt. (Der Satz von Euler-Fermat kann dabei teilweise hilfreich sein.) Berechnen Sie anschließend aus den Werten $b$ und $c$ mit Hilfe des chinesischen Restsatzes die letzten drei Ziffern von

$
d = 2026(^{51793^{2804}})
$

(d.h. den Wert $d$ mod 1000). Für diesen Schritt können Sie einen Taschenrechner zur Hilfe nehmen.

Beispiel 6.2. Alice und Bob führen einen Diffie-Hellman-Schlüsselaustausch durch. Dazu vereinbaren Sie zuerst eine Primzahl $p$ und eine natürliche Zahl $k < p.$ Dann wählt Alice eine natürliche Zahl $a < p$ und übermittelt $A = k^a$ mod $p$ an Bob. Analog wählt Bob eine natürliche Zahl $b < p$ und übermittelt $B = k^b$ mod $p$ an Alice. Aus diesen Werten berechnen sie den Schlüssel

$
s \equiv A^b \text{ mod } p \equiv B^a \text{ mod } p.
$

Eve hört die übermittelten Zahlen $p, k, A$ und $B$ ab. Welche der folgenden Zahlen können dabei vorkommen? Berechnen Sie gegebenenfalls die Parameter $a, b$ und den Schlüssel $s.$

1. $p = 149, k = 44, A = 105, B = 15;$

2. $p = 199, k = 100, A = 124, B = 187;$

3. $p = 249, k = 17, A = 12, B = 47.$

        Beispiel 6.3. Welche der folgenden Zahlenpaare $(m, r)$ können als öffentliche Schlüssel für eine RSA-Verschlüsselung mit Verschlüsselungsfunktion $f(k) = k^r$ mod $m$ verwendet werden? Berechnen Sie gegebenenfalls den privaten Schlüssel $s,$ der für die Entschlüsselungsfunktion $g(k) = k^s$ mod $m$ benötigt wird.

        1. $(m, r) = (331,145)$ (b) $(m, r) = (341,155)$

        2. $(m, r) = (361,165)$ (d) $(m, r) = (371,175)$

Beispiel 6.4. Die Zahlenfolge $(2,10,42,111)$ wurde per RSA-Verfahren mit dem öffentlichen Schlüssel $m = 671$ und $r = 343$ verschlüsselt. Ermitteln Sie den privaten Schlüssel $s$ und entschlüsseln Sie die Nachricht. Rechnen Sie beim Entschlüsseln modulo $m ($und nicht modulo $p$ und $q$ wie in Beispiel 6.5).

1

Beispiel 6.5. Die Entschlüsselung beim RSA-Verfahren kann effizienter gestaltet werden, wenn man $g(k) = k^s$ mod $m$ nicht direkt berechnet, sondern zunächst $g_p(k) = k^s$ mod $p$ und $g_q(k) = k^s$ mod $q$ ausrechnet und dann $g(k)$ mit Hilfe des chinesischen Restsatzes aus $g_p(k)$ und $g_q(k)$ bestimmt. Führen Sie obiges Prinzip für den Schlüssel $m = 533 = 13 \cdot 41$ und $s = 89$ aus, um die Nachricht $(420,378,81,441)$ zu entschlüsseln. *Erinnerung:* Die entschlüsselte Nachricht sollte aus natürlichen Zahlen kleiner $m$ bestehen.
