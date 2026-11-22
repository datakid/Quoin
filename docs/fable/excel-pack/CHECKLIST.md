# Quoin real-Excel check

Quoin writes Excel files itself, and the only way to know Excel accepts them is to open them in Excel. This list has one block per case. For each case, open the input first, then the output, and tick every line that is true. A box that is not ticked means the check was not done or failed; nothing is checked until you tick it.

Before you start:

- Use a copy of the pack, not your own workbooks. Every file here is test data.
- Write down the Excel version and build (File > Account > About Excel) and the system: ____________________
- If Excel shows any message when opening an output (repair, recovery, "unreadable content", a security warning that the input did not show), do not click through it: copy its exact text into Notes and tick nothing else for that case.

For each case write Pass, Fail or Not done on the Result line. A case passes only when every line is ticked.

## Macros

### M01 Replace the code of a module

What Quoin did: Replaced the code of Module1 (the procedure Macro1) with a version that shows a message box.

Files: `cases/M01-replace-module/` (input.xlsm, output.xlsm)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Alt+F11: the project lists Module1, ThisWorkbook and Sheet1, and Module1 holds the new code.
- [ ] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.
- [ ] Alt+F8, run Macro1: a message box says "Macro1 replaced by Quoin".
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### M02 Add a standard module

What Quoin did: Added a standard module called Module2 with the procedure QuoinAdded.

Files: `cases/M02-add-module/` (input.xlsm, output.xlsm)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Alt+F11: Module2 is listed under Modules and holds the procedure QuoinAdded. Module1 is still there.
- [ ] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.
- [ ] Alt+F8, run QuoinAdded: a message box says "Added by Quoin". Run Macro1: cell A1 becomes 123.
- [ ] File > Save As .xlsm, close and reopen: both modules are still there.

Result: ____________   Notes: ______________________________________________

### M03 Remove a standard module

What Quoin did: Removed the standard module Module1. The sheet and workbook modules are left alone.

Files: `cases/M03-remove-module/` (input.xlsm, output.xlsm)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Alt+F11: Module1 is gone; ThisWorkbook and Sheet1 remain and the Modules folder is empty or absent.
- [ ] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.
- [ ] Alt+F8: Macro1 is no longer listed.
- [ ] File > Save As .xlsm, close and reopen: the project is unchanged.

Result: ____________   Notes: ______________________________________________

### M04 Replace text inside macro code

What Quoin did: Replaced "123" with "456" in the code of every module.

Files: `cases/M04-replace-text-in-module/` (input.xlsm, output.xlsm)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Alt+F11: Module1 contains "456" and no "123".
- [ ] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.
- [ ] Alt+F8, run Macro1: cell A1 becomes 456.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

## Signed macro projects

### M05 Replace a module in a signed project

What Quoin did: Replaced the code of say_hello in Module1, after confirming that the signature is lost.

Files: `cases/M05-signed-replace-module/` (input.xlsm, output.xlsm)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] Alt+F11 > Tools > Digital Signature: the input shows a certificate name (it is signed).
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Alt+F11 > Tools > Digital Signature on the output shows "No certificate": Quoin removed the signature and said so.
- [ ] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.
- [ ] Alt+F8, run say_hello: a message box says "Hello from Quoin".
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### M06 Add a module to a signed project

What Quoin did: Added Module2, after confirming that the signature is lost.

Files: `cases/M06-signed-add-module/` (input.xlsm, output.xlsm)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] Alt+F11 > Tools > Digital Signature: the input shows a certificate name (it is signed).
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Alt+F11 > Tools > Digital Signature on the output shows "No certificate": Quoin removed the signature and said so.
- [ ] Alt+F11: Module2 is listed with the procedure QuoinAdded.
- [ ] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.
- [ ] Alt+F8, run QuoinAdded and say_hello: both show a message.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### M07 Remove a module from a signed project

What Quoin did: Removed Module1, after confirming that the signature is lost.

Files: `cases/M07-signed-remove-module/` (input.xlsm, output.xlsm)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] Alt+F11 > Tools > Digital Signature: the input shows a certificate name (it is signed).
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Alt+F11 > Tools > Digital Signature on the output shows "No certificate": Quoin removed the signature and said so.
- [ ] Alt+F11: Module1 is gone; ThisWorkbook and Sheet1 remain.
- [ ] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

## Macros

### M08 A project locked for viewing must be refused

What Quoin did: Nothing: this case needs a file you make in Excel. Quoin must refuse to change a project that is locked for viewing and write nothing.

Open input.xlsm in Excel, press Alt+F11, Tools > VBAProject Properties > Protection, tick "Lock project for viewing", set a password, press OK, save as protected.xlsm, close Excel. Then give protected.xlsm to Quoin with recipe.json (add a module). recipe.json is in this folder.

Files: `cases/M08-protected-project/` (input.xlsm, recipe.json)

- [ ] The unprotected input opens with no message.
- [ ] After you lock it: the saved protected.xlsm opens and asks for the password only when you open the project.
- [ ] Quoin refuses the file with the reason that the project is locked, and writes no output file.
- [ ] protected.xlsm, opened again, is exactly as you saved it (Quoin changed nothing).

Result: ____________   Notes: ______________________________________________

## Queries

### Q01 Replace the text of a query

What Quoin did: Replaced the text of the query StudentResults with a version that adds a column Version, and set it to refresh when the file opens.

Files: `cases/Q01-replace-query/` (input.xlsx, output.xlsx)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Data > Queries & Connections lists StudentResults. Double-click it: the Advanced Editor shows a step called "Added Version".
- [ ] Data > Refresh All finishes with no error message.
- [ ] On the sheet StudentResults the table has a column Version filled with "Quoin pack Q01".
- [ ] The table StudentNames on the sheet Input is unchanged.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### Q02 Add a query

What Quoin did: Added a connection-only query called "Student Names Copy" that reads the table StudentNames. No table, sheet or connection was created.

Files: `cases/Q02-add-query/` (input.xlsx, output.xlsx)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Data > Queries & Connections lists "Student Names Copy" next to StudentResults.
- [ ] Double-click "Student Names Copy": the editor opens and the preview shows the columns Name and Age.
- [ ] Right-click it > Load To... > Table loads the data into a new sheet with no error.
- [ ] Data > Refresh All finishes with no error message.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### Q03 Add queries whose names need quoting or escaping

What Quoin did: Added four connection-only queries named "Totals (2026)", "Résumé 2026", "a.b", "q1_2026".

Files: `cases/Q03-add-awkward-names/` (input.xlsx, output.xlsx)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Data > Queries & Connections lists all four names exactly as written: Totals (2026) | Résumé 2026 | a.b | q1_2026.
- [ ] Double-click each of the four: the editor opens and shows data. Write down any name Excel changes or refuses.
- [ ] Data > Refresh All finishes with no error message.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### Q04 Remove a query that Quoin added

What Quoin did: Removed "Student Names Copy" from the output of Q02. Quoin only removes a query that has no connection and loads nowhere.

The input of this case is the output of Q02.

Files: `cases/Q04-remove-query/` (input.xlsx, output.xlsx)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Data > Queries & Connections lists only StudentResults.
- [ ] Data > Queries & Connections > Connections tab (or Workbook Connections) has no "Student Names Copy".
- [ ] Data > Refresh All finishes with no error message.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### Q05 Rename a query that Quoin added

What Quoin did: Renamed "Student Names Copy" to "Renamed By Quoin" in the output of Q02.

The input of this case is the output of Q02.

Files: `cases/Q05-rename-query/` (input.xlsx, output.xlsx)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] Data > Queries & Connections lists "Renamed By Quoin" and does not list "Student Names Copy".
- [ ] Double-click "Renamed By Quoin": the editor opens and the preview shows the columns Name and Age.
- [ ] Data > Refresh All finishes with no error message.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### Q06 Replace text inside query code

What Quoin did: Replaced DateTime.LocalNow() with DateTime.FixedLocalNow() in every query.

Files: `cases/Q06-replace-text-in-query/` (input.xlsx, output.xlsx)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] StudentResults in the Advanced Editor contains DateTime.FixedLocalNow() and no DateTime.LocalNow().
- [ ] Data > Refresh All finishes with no error message.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

## Results

### T01 Result as a new file per table

What Quoin did: Wrote the table StudentNames and the table StudentResults each into its own new workbook with one sheet called Result and plain values only.

Files: `cases/T01-new-file-per-unit/` (input.xlsx, pq_simple__StudentNames.xlsx, pq_simple__StudentResults.xlsx)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] Both output files open with no repair or recovery message.
- [ ] Each has exactly one sheet, called Result, with a header row and the data of its table.
- [ ] Data > Queries & Connections is empty and no cell holds a formula: the values are plain.
- [ ] The column Age holds numbers (right-aligned) and the column DateTimeGenerated holds real dates and times, not text.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### T02 Result as new sheets in a copy of the workbook

What Quoin did: Made a copy of the workbook and added one sheet per table after the existing sheets, with the values of that table.

Files: `cases/T02-new-sheet-in-copy/` (input.xlsx, output.xlsx)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] The workbook has its two original sheets (Input, StudentResults) and then two new sheets called Result and Result-2, each with a header row and data.
- [ ] The original sheets, their tables and the query StudentResults are unchanged. Cell formats on the original sheets look the same as in the input.
- [ ] On the original sheets, dates and numbers still show the same values (compare a date column with the input).
- [ ] Data > Refresh All finishes with no error message.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### T03 Results combined into one new workbook

What Quoin did: Put the result of every table into one new workbook, one sheet per table.

Files: `cases/T03-combined-workbook/` (input.xlsx, output.xlsx)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] The workbook has two sheets, pq_simple__StudentNames and pq_simple__StudentResults (named after the file and the table), each with a header row and the data of its table.
- [ ] No queries, no formulas: plain values.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### T04 New sheets in a copy of a macro workbook

What Quoin did: Added one sheet per table to a copy of a macro-enabled workbook. The macro project is not touched.

Files: `cases/T04-new-sheet-in-macro-workbook/` (input.xlsm, output.xlsm)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] The workbook has its original sheet and the new Result sheets with data.
- [ ] Alt+F11: ThisWorkbook and Sheet1 are still in the project and the code is the same as in the input.
- [ ] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.
- [ ] Write down what Alt+F11 shows for the new sheets: Excel may add a module for each. Report anything unexpected.
- [ ] Data > Refresh All finishes with no error message.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

### T05 A new sheet in a signed macro workbook

What Quoin did: Added a sheet called Result to a copy of a signed macro workbook. The macro project and its signature are not touched.

Files: `cases/T05-new-sheet-in-signed-workbook/` (input.xlsm, output.xlsm)

- [ ] The input opens in Excel with no message. Click Enable Editing if Protected View appears.
- [ ] Alt+F11 > Tools > Digital Signature: the input shows a certificate name.
- [ ] The output opens with no repair, recovery or "unreadable content" message.
- [ ] The workbook has the original sheets and a new sheet Result with two rows, Ann and Bo.
- [ ] Alt+F11 > Tools > Digital Signature on the output: write down whether the certificate is still shown, shows "invalid" or shows "No certificate". Quoin expects the signature to be kept because the project is not touched.
- [ ] In the VBA editor (Alt+F11), Debug > Compile VBAProject finishes with no error.
- [ ] File > Save As, under a new name, works with no message, and the saved copy opens again.

Result: ____________   Notes: ______________________________________________

