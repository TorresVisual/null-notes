# Print Export Fixture

## 1. Overview

A synthetic note used by the export-to-PDF end-to-end test: long code blocks that must split across pages, short ones that must not, and a table whose cells hold long unbreakable inline code.

## 2. Diagram

The architecture in one block:

```text
+----------------------------------------------------------------------------+
| Client -> Controller -> Service -> Repository -> In-memory list of notebooks |
+----------------------------------------------------------------------------+
```

### 3.1 Sample1.java

Sample1.java

```java
public class Sample1 {
    // step 0
    int value1 = compute1(input, 1);
    int value2 = compute2(input, 2);
    int value3 = compute3(input, 3);
    int value4 = compute4(input, 4);
    int value5 = compute5(input, 5);
    int value6 = compute6(input, 6);
    // step 7
    int value8 = compute8(input, 8);
    int value9 = compute9(input, 9);
    int value10 = compute10(input, 10);
    int value11 = compute11(input, 11);
    int value12 = compute12(input, 12);
    int value13 = compute13(input, 13);
    // step 14
    int value15 = compute15(input, 15);
    int value16 = compute16(input, 16);
    int value17 = compute17(input, 17);
    int value18 = compute18(input, 18);
    int value19 = compute19(input, 19);
    int value20 = compute20(input, 20);
    // step 21
    int value22 = compute22(input, 22);
    int value23 = compute23(input, 23);
    int value24 = compute24(input, 24);
    int value25 = compute25(input, 25);
    int value26 = compute26(input, 26);
    int value27 = compute27(input, 27);
    // step 28
    int value29 = compute29(input, 29);
    int value30 = compute30(input, 30);
    int value31 = compute31(input, 31);
    int value32 = compute32(input, 32);
    int value33 = compute33(input, 33);
    int value34 = compute34(input, 34);
    // step 35
    int value36 = compute36(input, 36);
    int value37 = compute37(input, 37);
    int value38 = compute38(input, 38);
    int value39 = compute39(input, 39);
    int value40 = compute40(input, 40);
    int value41 = compute41(input, 41);
    // step 42
    int value43 = compute43(input, 43);
    int value44 = compute44(input, 44);
    int value45 = compute45(input, 45);
    int value46 = compute46(input, 46);
    int value47 = compute47(input, 47);
    int value48 = compute48(input, 48);
    // step 49
    int value50 = compute50(input, 50);
    int value51 = compute51(input, 51);
    int value52 = compute52(input, 52);
    int value53 = compute53(input, 53);
    int value54 = compute54(input, 54);
    int value55 = compute55(input, 55);
    // step 56
    int value57 = compute57(input, 57);
    int value58 = compute58(input, 58);
    int value59 = compute59(input, 59);
}
```

A paragraph after the block explains what it does, so a block that ends near the bottom of a page is followed by prose.

### 3.2 Sample2.java

Sample2.java

```java
public class Sample2 {
    // step 0
    int value1 = compute1(input, 1);
    int value2 = compute2(input, 2);
    int value3 = compute3(input, 3);
    int value4 = compute4(input, 4);
    int value5 = compute5(input, 5);
    int value6 = compute6(input, 6);
    // step 7
    int value8 = compute8(input, 8);
    int value9 = compute9(input, 9);
    int value10 = compute10(input, 10);
    int value11 = compute11(input, 11);
}
```

A paragraph after the block explains what it does, so a block that ends near the bottom of a page is followed by prose.

### 3.3 Sample3.java

Sample3.java

```java
public class Sample3 {
    // step 0
    int value1 = compute1(input, 1);
    int value2 = compute2(input, 2);
    int value3 = compute3(input, 3);
    int value4 = compute4(input, 4);
    int value5 = compute5(input, 5);
    int value6 = compute6(input, 6);
    // step 7
    int value8 = compute8(input, 8);
    int value9 = compute9(input, 9);
    int value10 = compute10(input, 10);
    int value11 = compute11(input, 11);
    int value12 = compute12(input, 12);
    int value13 = compute13(input, 13);
    // step 14
    int value15 = compute15(input, 15);
    int value16 = compute16(input, 16);
    int value17 = compute17(input, 17);
    int value18 = compute18(input, 18);
    int value19 = compute19(input, 19);
    int value20 = compute20(input, 20);
    // step 21
    int value22 = compute22(input, 22);
    int value23 = compute23(input, 23);
    int value24 = compute24(input, 24);
    int value25 = compute25(input, 25);
    int value26 = compute26(input, 26);
    int value27 = compute27(input, 27);
    // step 28
    int value29 = compute29(input, 29);
    int value30 = compute30(input, 30);
    int value31 = compute31(input, 31);
    int value32 = compute32(input, 32);
    int value33 = compute33(input, 33);
    int value34 = compute34(input, 34);
    // step 35
    int value36 = compute36(input, 36);
    int value37 = compute37(input, 37);
    int value38 = compute38(input, 38);
    int value39 = compute39(input, 39);
    int value40 = compute40(input, 40);
    int value41 = compute41(input, 41);
    // step 42
    int value43 = compute43(input, 43);
    int value44 = compute44(input, 44);
    int value45 = compute45(input, 45);
    int value46 = compute46(input, 46);
    int value47 = compute47(input, 47);
    int value48 = compute48(input, 48);
    // step 49
    int value50 = compute50(input, 50);
    int value51 = compute51(input, 51);
    int value52 = compute52(input, 52);
    int value53 = compute53(input, 53);
    int value54 = compute54(input, 54);
    int value55 = compute55(input, 55);
    // step 56
    int value57 = compute57(input, 57);
    int value58 = compute58(input, 58);
    int value59 = compute59(input, 59);
    int value60 = compute60(input, 60);
    int value61 = compute61(input, 61);
    int value62 = compute62(input, 62);
    // step 63
    int value64 = compute64(input, 64);
    int value65 = compute65(input, 65);
    int value66 = compute66(input, 66);
    int value67 = compute67(input, 67);
    int value68 = compute68(input, 68);
    int value69 = compute69(input, 69);
    // step 70
    int value71 = compute71(input, 71);
    int value72 = compute72(input, 72);
    int value73 = compute73(input, 73);
    int value74 = compute74(input, 74);
}
```

A paragraph after the block explains what it does, so a block that ends near the bottom of a page is followed by prose.

### 3.4 Sample4.java

Sample4.java

```java
public class Sample4 {
    // step 0
    int value1 = compute1(input, 1);
    int value2 = compute2(input, 2);
    int value3 = compute3(input, 3);
    int value4 = compute4(input, 4);
}
```

A paragraph after the block explains what it does, so a block that ends near the bottom of a page is followed by prose.

### 3.5 Sample5.java

Sample5.java

```java
public class Sample5 {
    // step 0
    int value1 = compute1(input, 1);
    int value2 = compute2(input, 2);
    int value3 = compute3(input, 3);
    int value4 = compute4(input, 4);
    int value5 = compute5(input, 5);
    int value6 = compute6(input, 6);
    // step 7
    int value8 = compute8(input, 8);
    int value9 = compute9(input, 9);
    int value10 = compute10(input, 10);
    int value11 = compute11(input, 11);
    int value12 = compute12(input, 12);
    int value13 = compute13(input, 13);
    // step 14
    int value15 = compute15(input, 15);
    int value16 = compute16(input, 16);
    int value17 = compute17(input, 17);
    int value18 = compute18(input, 18);
    int value19 = compute19(input, 19);
    int value20 = compute20(input, 20);
    // step 21
    int value22 = compute22(input, 22);
    int value23 = compute23(input, 23);
    int value24 = compute24(input, 24);
    int value25 = compute25(input, 25);
    int value26 = compute26(input, 26);
    int value27 = compute27(input, 27);
    // step 28
    int value29 = compute29(input, 29);
    int value30 = compute30(input, 30);
    int value31 = compute31(input, 31);
    int value32 = compute32(input, 32);
    int value33 = compute33(input, 33);
    int value34 = compute34(input, 34);
    // step 35
    int value36 = compute36(input, 36);
    int value37 = compute37(input, 37);
    int value38 = compute38(input, 38);
    int value39 = compute39(input, 39);
    int value40 = compute40(input, 40);
    int value41 = compute41(input, 41);
    // step 42
    int value43 = compute43(input, 43);
    int value44 = compute44(input, 44);
    int value45 = compute45(input, 45);
    int value46 = compute46(input, 46);
    int value47 = compute47(input, 47);
    int value48 = compute48(input, 48);
    // step 49
}
```

A paragraph after the block explains what it does, so a block that ends near the bottom of a page is followed by prose.

## 4. Endpoints

| Method | Endpoint | Return Type |
| --- | --- | --- |
| `getNotebookEntries0` | `/notebooks/{id}/entries/{entry_id}/0` | `ResponseEntity<NotebookEntriesResponse0>` (200) |
| `getNotebookEntries1` | `/notebooks/{id}/entries/{entry_id}/1` | `ResponseEntity<NotebookEntriesResponse1>` (200) |
| `getNotebookEntries2` | `/notebooks/{id}/entries/{entry_id}/2` | `ResponseEntity<NotebookEntriesResponse2>` (200) |
| `getNotebookEntries3` | `/notebooks/{id}/entries/{entry_id}/3` | `ResponseEntity<NotebookEntriesResponse3>` (200) |
| `getNotebookEntries4` | `/notebooks/{id}/entries/{entry_id}/4` | `ResponseEntity<NotebookEntriesResponse4>` (200) |
| `getNotebookEntries5` | `/notebooks/{id}/entries/{entry_id}/5` | `ResponseEntity<NotebookEntriesResponse5>` (200) |
| `getNotebookEntries6` | `/notebooks/{id}/entries/{entry_id}/6` | `ResponseEntity<NotebookEntriesResponse6>` (200) |
| `getNotebookEntries7` | `/notebooks/{id}/entries/{entry_id}/7` | `ResponseEntity<NotebookEntriesResponse7>` (200) |

## 5. Closing

The end.
