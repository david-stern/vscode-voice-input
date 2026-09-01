# חוזה UX — Voice Input Control Center

**סטטוס:** חוזה מחייב למימוש ולבדיקות

**גרסה:** 1.0

**תחולה:** Control Center, מפעיל sidebar, ניווט, overlays וגבול host↔webview

## 1. מטרה ועקרונות מחייבים

ה־UI בנוי סביב משימה אחת בכל רגע: לדבר, להפעיל פקודה, או להגדיר את המערכת. כל מסך מהותי נפתח ב־Control Center יחיד באזור העורך של VS Code. “מסך מלא” בחוזה זה הוא מלוא שטח קבוצת העורך הזמין; הוא אינו מסתיר את מעטפת VS Code ואינו יוצר חלון מערכת הפעלה עצמאי.

המימוש חייב לעמוד בעקרונות הבאים:

1. מקור אמת אחד: ה־Extension Host מחזיק state, סמכות ופעולות; ה־webview מציג ושולח intents בלבד.
2. singleton אחד לכל VS Code window/Extension Host. פתיחה חוזרת חושפת אותו instance.
3. Sidebar הוא launcher קומפקטי, לא מסך הגדרות שני.
4. בכל route יש H1 יחיד, פעולה ראשית ברורה, מצב מערכת נראה וצעד התאוששות קונקרטי.
5. אין יותר מ־overlay אחד. modal מיועד להחלטה חוסמת; drawer מיועד להקשר משני שניתן לסגור בלי לעזוב route.
6. כל פעולה אפשרית במקלדת, עובדת ב־RTL/LTR, ב־high contrast, ב־reduced motion וב־320 CSS px ללא גלילה אופקית.
7. partial transcript הוא תצוגה בלבד. רק final transcript רשאי להגיע ל־matcher.
8. DOM אינו מעניק סמכות. הפעלת Auto Mode ואישור פעולה רגישה מסתיימים רק דרך prompt native של VS Code.

החוזה מסתמך על [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview), על [WAI-ARIA Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), ועל [WCAG 2.2](https://www.w3.org/TR/WCAG22/). תיעוד VS Code מגדיר `reveal()`, ‏`localResourceRoots`, ‏CSP, lifecycle, serializer ו־state; APG מגדיר focus trap/return ו־Escape; WCAG מגדיר reflow ב־320 CSS px, סדר מוקד והודעות מצב.

## 2. ארכיטקטורת המשטחים

### 2.1 Control Center קנוני

- `viewType`: ‏`voiceInput.controlCenter`.
- ה־host חושף API יחיד: `createOrShow(route?, params?)`.
- אם אין panel, הוא נוצר בעמודת העורך הפעילה.
- אם panel קיים, הוא נחשף באמצעות `reveal()` ומקבל deep link חדש; אין יצירה נוספת.
- command, serializer, Activity Bar, status bar, sidebar וכל alias ישן עוברים דרך controller serialized יחיד.
- אם serializer ו־command מתחרים, ה־panel הראשון שאומץ נשאר; השני נסגר. ה־deep link המפורש האחרון מועבר ל־panel הקנוני.
- `retainContextWhenHidden` הוא `false`. reveal/reload תמיד מתחילים handshake חדש מול host state.
- סגירת panel מנקה subscriptions, listeners, timers, queued focus targets ו־reference. הורדה או inference host-owned ממשיכים ואינם משוגרים שוב בפתיחה הבאה.

הגדרות panel מחייבות:

| אפשרות | ערך |
|---|---|
| `enableScripts` | `true` |
| `enableCommandUris` | `false` |
| `retainContextWhenHidden` | `false` |
| `localResourceRoots` | תיקיית נכסי Control Center הארוזה בלבד |

### 2.2 Sidebar קומפקטי

ה־sidebar כולל, בסדר DOM זהה ב־HE וב־EN:

1. שם המוצר ומצב provider/readiness.
2. badge גלוי של `AUTO` כאשר הוא פעיל.
3. quick mic button עם label נראה, `aria-pressed`, shortcut ומצב חי.
4. transcript אחרון בלבד: partial מסומן “זמני”/“Partial”; final מסומן “סופי”/“Final”.
5. pending action קצר: שם, מצב וקישור “סקירה במרכז הבקרה”.
6. כפתור ראשי “פתח את מרכז הבקרה”.
7. שני deep links משניים בלבד: Voice ו־Commands.

אסור לכלול sidebar forms עבור provider, persona, model, voice, mappings, history או settings tree. `voiceInput.settingsView` נשאר בגרסת המעבר launcher בלבד: הוא פותח את route המתאים באותו panel ואינו מרנדר Settings DOM.

## 3. מפת מידע ו־routes

קיימים בדיוק שישה route IDs:

| ID | כותרת HE / EN | מטרת המשתמש | פעולה ראשית | מוקד לאחר ניווט |
|---|---|---|---|---|
| `home` | בית / Home | להבין readiness והצעד הבא | התחלת/המשך setup או התחלת הקלטה | `h1#route-title-home` |
| `voice` | קול ומיקרופון / Voice & Microphone | לבחור input, לבדוק STT/TTS ולהקליט | Start/Stop microphone test | `h1#route-title-voice` |
| `commands` | פקודות / Commands | למצוא, להפעיל ולשנות פקודות | חיפוש; כאשר ריק — יצירת custom command | `h1#route-title-commands` |
| `assistant` | עוזר וספקים / Assistant & Providers | לבחור local/Soniox ולהגדיר עוזר | בחירת provider או בדיקת חיבור | `h1#route-title-assistant` |
| `privacy` | פרטיות ובטיחות / Privacy & Safety | להבין network/Auto/consent ולכבות Auto | Toggle Auto off; enable פותח flow מאובטח | `h1#route-title-privacy` |
| `diagnostics` | אבחון / Diagnostics | לזהות תקלה ולייצא מידע לא־רגיש | Run diagnostics | `h1#route-title-diagnostics` |

מיפוי legacy מחייב:

| route ישן | route חדש |
|---|---|
| `setup` | `home` + `setupStep` מאומת |
| `home` | `home` |
| `conversation`, `voice` | `voice` |
| `actions` | `commands` |
| `agents`, `providers` | `assistant` |
| `privacy` | `privacy` |
| `diagnostics` | `diagnostics` |

route לא מוכר אינו נפתח ואינו נשמר; ה־host רושם rejection content-free ומציג `home`.

## 4. Wireframes מחייבים

### 4.1 Wide — navigation קבוע

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ [Skip to content]  Voice Input                  Local ready  [AUTO OFF] │
├───────────────────┬──────────────────────────────────────────────────────┤
│ Primary navigation│ MAIN                                                 │
│ Home              │ H1 Voice & Microphone                               │
│ Voice & Microphone│ One-sentence purpose                                │
│ Commands          │                                                      │
│ Assistant         │ ┌ Readiness / recovery card ──────────────────────┐ │
│ Privacy & Safety  │ │ status, reason, one primary next action         │ │
│ Diagnostics       │ └──────────────────────────────────────────────────┘ │
│                   │                                                      │
│                   │ Route content                                        │
│                   │                                                      │
│                   │ [Primary action] [Secondary action]                  │
├───────────────────┴──────────────────────────────────────────────────────┤
│ Status regions: progress | result | error                               │
└──────────────────────────────────────────────────────────────────────────┘
```

- Header, named navigation, `main` ו־status area הם landmarks נפרדים.
- navigation הוא עמודה בגודל תוכן עם logical properties; main גמיש.
- אין sticky footer שמסתיר focus. action bar נהיה static כאשר אינו יכול להישאר גלוי בלי לכסות תוכן.
- רוחב התוכן מוגבל לקריאות, אך טבלאות/רשימות משתמשות בכל הרוחב הזמין.

### 4.2 Narrow / 320 CSS px / zoom

```text
┌──────────────────────────────┐
│ [Menu] Voice Input [AUTO]    │
├──────────────────────────────┤
│ MAIN                         │
│ H1 Commands                  │
│ Purpose                      │
│ [Search....................] │
│ [Category ▼] [Filters ▼]     │
│                              │
│ Command row                  │
│ Phrase / availability        │
│ [Enabled] [Edit]             │
│                              │
│ [Previous] Page 1/4 [Next]   │
├──────────────────────────────┤
│ Status                       │
└──────────────────────────────┘
```

- ה־navigation הקבוע מוחלף ב־Menu button וב־navigation drawer יחיד.
- התוכן הוא עמודה אחת. table rows רשאים לעבור לתצוגת stacked row, אך שם/role/value וסדר DOM נשמרים.
- אין overflow אופקי ב־320 CSS px; strings ארוכים נשברים או נחתכים עם דרך נגישה לחשוף את מלוא הערך.
- בדיקה נפרדת מתבצעת גם ב־200% text zoom. יעד pointer אינטראקטיבי הוא לפחות `44×44` CSS px; זהו יעד מוצר מחמיר יותר ממינימום AA.

### 4.3 Home ו־setup בן ארבעה שלבים

Setup אינו route. הוא section בתוך `home` עם progress label טקסטואלי “שלב X מתוך 4”:

1. בחירת מיקרופון ובדיקת signal לא־אפס.
2. Local Voice Packs: כרטיס נפרד ל־STT וכרטיס נפרד ל־TTS, ובנוסף summary משולב. כל כרטיס מציג שם, שפות, exact bytes, רישיון, footprint מותקן, status ופעולת install/remove/retry. פעולה מודרכת אחת רשאית לבחור ולהתקין את שניהם, אך כל pack מאומת ומותקן בנפרד. לחיצה מפורשת על Download היא תנאי לפתיחת modal הסכמה; אין auto-download בהפעלה ראשונה, ב־startup, ב־route navigation או אחרי update.
3. בדיקת STT ו־TTS מקומיים. ההצלחה דורשת transcript נשמע/נראה ו־TTS audible.
4. Soniox ועוזר חכם מוצגים כשתי אפשרויות בלתי תלויות, עם “דלג” נראה.

state משוחזר רשאי להכיל רק `setupStep: 1..4`; modal, download intent או pending approval אינם משוחזרים. מצב download בפועל מגיע מה־host operation snapshot.

#### חוזה ניהול שתי החבילות

ה־catalog מגדיר שני artifacts data-only נפרדים:

| Pack | תפקיד | שער גודל | ניהול עצמאי |
|---|---|---:|---|
| STT | microphone → final transcript | `<= 600,000,000 bytes` | install, cancel, retry, repair, remove |
| TTS | text → PCM/playback | `<= 600,000,000 bytes` | install, cancel, retry, repair, remove |

כאשר שניהם נבחרים ב־first-use guided action, סכום `expectedBytes` חייב להיות `<= 1,100,000,000 bytes`. הסף תואם למועמדים הנוכחיים: STT ‏`453,071,794` bytes ו־TTS ‏`593,121,124` bytes, יחד `1,046,192,918` bytes, ומשאיר `53,807,082` bytes ל־manifest/notices. ה־UI מציג תמיד, לפני consent:

- STT download bytes ורישיון בשורה נפרדת;
- TTS download bytes ורישיון בשורה נפרדת;
- `Combined download` כסכום exact bytes ובפורמט אנושי;
- installed footprint נוכחי לכל pack ובסך הכול;
- estimated additional disk ו־storage root כללי, ללא חשיפת home path מלא ל־webview;
- הבהרה שהפעולה תתקין שתי חבילות עצמאיות ושאפשר להסיר כל אחת בנפרד.

ה־host מחשב bytes מתוך manifests מקובעים; ה־webview אינו מסכם ערכים שסופקו מה־DOM. display אנושי לעולם אינו מחליף את exact-byte gate. אם pack יחיד או הסכום חורגים מהסף, Download מושבת, מוצגת סיבה, ואין intent להורדה.

פעולה מודרכת משולבת מתקינה ברצף כדי לצמצם temporary disk peak. progress מציג row נפרד לכל pack (`queued/downloading/verifying/installing/ready/failed/cancelled`) וכן progress משולב `downloaded bytes / combined bytes`. Cancel ליד row מבטל רק אותו pack; “Cancel all” מבטל את הפעולה הפעילה ומסיר את התור. pack שכבר הגיע ל־`ready` נשאר מותקן ואינו עובר rollback סמוי. Retry מכוון רק ל־pack שנכשל ומציג שוב את bytes/license אם manifest השתנה.

Remove STT ו־Remove TTS הן פעולות נפרדות. ה־host מציג native VS Code warning עם שם ה־pack וה־bytes שיימחקו; אין DOM modal נוסף. הסרת STT משאירה TTS פעיל ומעבירה transcription ל־`download required`; הסרת TTS משאירה STT פעיל ומעבירה speech output ל־`download required`. “Remove both” מדווח בנפרד על תוצאת כל הסרה ועל combined bytes ששוחררו; כשל חלקי אינו מוצג כהצלחה מלאה.

### 4.4 Commands

- שדה חיפוש אחד עם label נראה; חיפוש ב־label, phrase ו־ID, בעברית ובאנגלית.
- שבעה category filters, “פעיל בלבד” ו־“שונה מברירת המחדל”.
- 25 תוצאות בעמוד, ללא virtualization.
- container משתמש בטבלת HTML כאשר המבנה טבלאי; אם responsive משנה presentation, הסמנטיקה נשארת טבלה תקינה.
- `aria-rowcount` שווה למספר התוצאות לאחר סינון, לא 100 קבוע.
- כל row: enabled toggle, label, phrase ראשי, slot/shortcut summary, availability, Edit.
- Edit פותח command drawer. executor ID ו־slot schema מוצגים read-only ואינם ניתנים לשינוי.
- שינוי filter/page מעביר focus לתוצאה הראשונה אם קיימת; אם לא, ל־empty-state heading. עדכון row מחזיר focus לאותו row לפי `commandId`; אם נעלם בגלל filter, focus חוזר ל־results heading.
- live region מודיע פעם אחת: “N תוצאות, עמוד X מתוך Y”. הוא אינו מקריא כל row.

### 4.5 מצבי route אחידים

כל route מממש בדיוק את המצבים הרלוונטיים:

| מצב | תוכן | פעולה | מוקד |
|---|---|---|---|
| `loading` | skeleton לא מהבהב + label “טוען” | אין פעולה כפולה | H1 נשאר ממוקד; `aria-busy=true` על region |
| `empty` | הסבר קצר וסיבה | פעולה אחת ליצירה/הגדרה | empty heading |
| `downloading` | STT/TTS rows עם bytes, אחוז ושלב; combined bytes; cancel per pack/all | Cancel בלבד | progress heading; עדכון לא גונב focus |
| `ready` | status חיובי + הפעולות הרלוונטיות | פעולה ראשית אחת | לפי route |
| `error` | מה נכשל, מה לא השתנה, error code לא־רגיש | Retry/Repair מותנה | error heading עם `role=alert` פעם אחת |
| `recovery` | state שזוהה + צעד בטוח | Resume UI/Restart download/Choose provider | recovery heading |
| `unsupported` | סיבה מדויקת, ללא CTA מטעה | View support details | H1 או status heading |

## 5. ניווט, מקלדת ו־focus

### 5.1 סדר מקלדת

1. Skip link.
2. Header actions.
3. Primary navigation או Menu button.
4. H1/main controls בסדר קריאה.
5. Route status/actions.
6. Footer/status links אם קיימים.

אין `tabindex` חיובי. סדר חזותי אינו נוצר באמצעות CSS `order` שמפר את סדר ה־DOM. חיצי מקלדת אינם נדרשים ל־nav רגיל; `Tab`/`Shift+Tab`, ‏`Enter` ו־`Space` משתמשים בהתנהגות native של links/buttons.

### 5.2 שינוי route

1. ה־webview שולח `navigateIntent`.
2. ה־host מאמת route/params, מקצה revision ומחזיר snapshot.
3. ה־webview מרנדר, מעדכן `<title>`, ‏`aria-current="page"` ו־H1.
4. focus עובר ל־H1 עם `tabindex="-1"`, אלא אם snapshot כולל focus target סמנטי תקף מתוצאת flow host-owned.
5. לאחר render+focus נשלח `ack(revision)`.

שינוי route אינו משתמש ב־live region נוסף; ה־H1 הממוקד מספק context. פתיחת drawer/modal מקבלת הודעה משלה ולכן אינה מתרחשת יחד עם הכרזת route.

### 5.3 Focus visible ו־RTL

- focus ring משתמש בטוקני VS Code (`--vscode-focusBorder`) ונראה בכל theme/high contrast.
- logical properties בלבד: `margin-inline`, ‏`padding-inline`, ‏`inset-inline`, ‏`border-inline`.
- `html.lang` ו־`html.dir` מגיעים מ־host snapshot: `he/rtl` או `en/ltr`.
- שינוי שפה אינו הופך את סדר ה־DOM ואינו משנה shortcuts.
- טקסט מעורב כגון branch/path/command ID עטוף ב־`bdi` או מקבל `dir="auto"`; ערכי קוד מוצגים LTR בלי להפוך punctuation.
- icons כיווניים בלבד משתקפים ב־RTL; mic, status, warning ו־Git icons אינם משתקפים.

## 6. Overlay contract

### 6.1 מכונת מצבים

```text
CLOSED
  ├─ openModal(kind, trigger) ──> DOM_MODAL
  ├─ openDrawer(kind, trigger) ─> DRAWER
DOM_MODAL
  ├─ cancel/Escape/Close ───────> CLOSED + returnFocus
  └─ continueToNative ──────────> CLOSED -> NATIVE_PROMPT_PENDING
DRAWER
  ├─ save/cancel/Escape/Close ──> CLOSED + returnFocus
  └─ requestNativePrompt ───────> CLOSED -> NATIVE_PROMPT_PENDING
NATIVE_PROMPT_PENDING
  └─ host result + snapshot ────> CLOSED + deferredReturnFocus
```

פתיחה כאשר state אינו `CLOSED` נדחית. ה־controller סוגר overlay קיים ורק לאחר cleanup רשאי לפתוח אחר; אין nesting ואין overlay DOM מתחת ל־native prompt.

### 6.2 Modal מותר

Modal DOM נפתח רק עבור:

1. הסכמה להורדת Local Voice Pack אחד או שניים. כאשר שניהם נבחרו, ה־modal מפרט STT ו־TTS, bytes ורישיון לכל אחד, combined bytes וסכום storage לפני פעולה אחת שמאשרת את שני ה־pack IDs המסוימים בלבד.
2. הסבר ואזהרה לפני בקשה להפעלת Auto Mode.
3. preview לפעולה confirmation-required כאשר Auto כבוי.

ה־modal הוא preview/explanation בלבד. ב־Auto או פעולה רגישה, Continue סוגר את modal, מסיר `inert`, ואז host קורא `vscode.window.showWarningMessage(message, { modal: true }, confirmAction)`. רק בחירה מפורשת שחזרה מה־API native מעניקה receipt/dispatch. Cancel/dismiss/timeout/forged message/replay אינם משנים authority.

### 6.3 Drawer מותר

Drawer נפתח רק עבור:

- command edit/reset/details;
- provider/model/endpoint advanced settings;
- navigation ב־narrow viewport.

Drawer אינו route ואינו נשמר. סגירה אינה מאבדת edits שכבר נשמרו ב־host; draft שלא נשמר מקבל confirmation מקומי רק אם איבודו מהותי, אך confirmation זה אינו מעניק authority.

### 6.4 סמנטיקה והתנהגות

כל modal/drawer overlay:

- `role="dialog"`, ‏`aria-modal="true"`, ‏`aria-labelledby` לכותרת נראית.
- רקע `inert`; fallback ל־focus guard/`aria-hidden` נבדק בדפדפן VS Code הנתמך.
- `Tab`/`Shift+Tab` נשארים בתוך overlay.
- `Escape` מבטל כאשר cancellation חוקי; בזמן commit point שאינו ניתן לביטול הכפתור מושבת והסיבה מוכרזת.
- Close נראה וטקסטואלי תמיד; אין סגירה בלעדית בלחיצה מחוץ ל־overlay.
- focus ראשוני עובר לפעולה הבטוחה. בתוכן ארוך הוא עובר לכותרת/פתיח סטטי עם `tabindex="-1"`.
- סגירה מחזירה focus ל־trigger; אם הוסר, ל־row לפי ID; אם גם הוא אינו קיים, ל־H1.
- לאחר native prompt, החזרת focus נדחית עד snapshot+ack, כדי לא להתמקד ב־DOM נסתר או שנבנה מחדש.

התנהגות זו תואמת את [WAI-ARIA Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): focus בתוך dialog, trapping, ‏Escape, שם נגיש ו־focus return.

## 7. הודעות ומצב host↔webview

### 7.1 Handshake ו־revision

```text
Webview -> Host: ready(lastAppliedRevision?)
Host -> Webview: stateSnapshot(revision, state, focusTarget?)
Webview: validate -> render -> focus
Webview -> Host: ack(revision)
```

- revision הוא integer מונוטוני host-owned.
- stale/duplicate snapshot אינו מרונדר ואינו מקבל ack חדש.
- host שומר לכל היותר deep link מפורש אחד בזמן bootstrap: האחרון בלבד.
- deep link מפורש גובר על state משוחזר. פתיחה כללית אינה דורסת deep link מפורש שכבר הוכנס לתור.
- `webview.setState` רשאי לשמור hint bounded בלבד; הוא אינו סמכותי. serializer מאמץ panel ומבקש snapshot מה־host.

### 7.2 State שניתן להציג/לשחזר

מותר לשמור ב־`workspaceState` בלבד:

```text
route: one of six IDs
commands.filter: <= 200 Unicode code points
commands.page: integer 1..4
setupStep: integer 1..4
revision: host-owned integer
```

אסור לשמור או לשחזר: modal/drawer, API key, path פרטי, transcript מלא, authority receipt/nonce, effective Auto proof, pending approval, action outcome או raw diagnostic payload.

### 7.3 Message envelope

כל הודעה בשני הכיוונים חייבת להיות plain own-property record עם prototype ‏`Object.prototype` או `null`, JSON-serializable, עד 64 KiB UTF-8, עומק עד 4 ועד 100 scalar values.

| כיוון | types מותרים | משמעות |
|---|---|---|
| webview→host | `ready`, `ack`, `navigateIntent`, `micIntent`, `filterIntent`, `pageIntent`, `openOverlayIntent`, `closeOverlayIntent`, `saveCommandIntent`, `packOperationIntent`, `cancelOperationIntent`, `providerIntent`, `autoModeIntent`, `actionReviewIntent`, `diagnosticsIntent` | בקשה בלבד; `packOperationIntent` מכיל operation allowlisted ו־pack IDs מה־catalog, לעולם לא URL/path; אין authority או outcome |
| host→webview | `stateSnapshot`, `operationProgress`, `operationResult`, `focusRequest`, `validationResult`, `capabilitiesChanged` | projection של state host-owned |

`params` מקבל עד שמונה keys ידועים. `filter` עד 200 code points, ‏`page` ‏1–4, ‏`commandId` מתוך 100 IDs ו־`setupStep` ‏1–4. unknown keys/types, accessors, prototype חריג, `__proto__`, ‏`prototype`, ‏`constructor`, oversized values וכל שדה authority כגון `confirmed`, ‏`approved`, ‏`receipt`, ‏`nonce`, ‏`effectiveAutoMode`, ‏`consentGranted` או action outcome נדחים ונרשמים content-free.

תוכן דינמי נכנס רק באמצעות `textContent`, ‏`setAttribute` לערכים allowlisted ו־DOM APIs בטוחים. אין `innerHTML`, ‏template HTML מתוכן, `eval`, URL ממשתמש או event handler inline.

## 8. CSP ומשאבים

כל נכס מקומי עובר `webview.asWebviewUri`. אסור ל־webview לקרוא workspace, ‏`globalStorageUri`, ‏home, model directory או network. download, Soniox ו־credential access הם host-side בלבד.

ה־CSP המחייב:

```text
default-src 'none';
script-src 'nonce-<nonce>';
style-src <webview.cspSource>;
font-src <webview.cspSource>;
img-src <webview.cspSource>;
connect-src 'none';
frame-src 'none';
object-src 'none';
worker-src 'none';
form-action 'none';
base-uri 'none';
```

אין `unsafe-inline`, ‏`unsafe-eval`, ‏`data:`, ‏`blob:`, remote URL, iframe או `command:` URI. אם font/image אינם נדרשים, directive שלהם מצטמצם ל־`none`.

## 9. Live regions ומשוב

יש שלושה ערוצי status נפרדים:

| ערוץ | ARIA | תוכן | קצב |
|---|---|---|---|
| progress | `role=status`, `aria-live=polite` | download/test/transcription progress | throttle; אחוז כל 10% או שינוי שלב |
| result | `role=status`, `aria-live=polite` | save/test/action success | הודעה אחת לתוצאה |
| error | `role=alert` | שגיאה שמחייבת תשומת לב | פעם אחת לכל error ID |

route change, overlay open, result ו־progress אינם מוכרזים בו־זמנית. field error מקושר ב־`aria-describedby` ומקבל `aria-invalid=true`; summary בראש form ממקד את השגיאה הראשונה רק לאחר submit.

## 10. דרישות חזותיות ונגישות

- צבעים, typography, focus, input, button, badge ו־severity משתמשים בטוקני VS Code בלבד; צבע לעולם אינו נשא המשמעות היחיד.
- touch/pointer targets בגודל מינימלי `44×44` CSS px.
- אין animation מהותית; במצב `vscode-reduce-motion` ו־`prefers-reduced-motion: reduce` transitions מבוטלים.
- high contrast אינו מסתמך על shadow או background בלבד; border/focus נשמרים.
- text scale של 200% ו־viewport של 320 CSS px אינם גורמים לאובדן תוכן/פעולה או לשתי גלילות. ראו [WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- status messages ניתנים לזיהוי ללא העברת focus, בהתאם ל־[WCAG 4.1.3](https://www.w3.org/TR/WCAG22/#status-messages).
- הפעלת screen reader/reduced motion דרך classes של VS Code מכובדת לפי [Webview accessibility guidance](https://code.visualstudio.com/api/extension-guides/webview#accessibility).

## 11. תרחישי קבלה מחייבים

### 11.1 Singleton/lifecycle

1. פתיחה מ־Command Palette, Activity Bar, status bar ו־sidebar משאירה panel אחד ומביאה אותו לחזית.
2. מרוץ serializer+command משאיר instance אחד; duplicate נסגר; ה־deep link המפורש האחרון קובע route ו־focus.
3. hide/reveal/reload/restart משחזרים רק route/filter/page/setupStep מה־host.
4. dispose/recreate אינו מכפיל listener, הודעה, download או dispatch.

### 11.2 Keyboard/screen reader

1. כל ששת routes, setup, pagination, command edit ו־provider settings ניתנים להשלמה keyboard-only.
2. modal/drawer מכריזים title/role, לוכדים focus, נסגרים ב־Escape/Close ומחזירים focus לפי fallback chain.
3. NVDA/Windows, VoiceOver/macOS ו־Orca/Linux כאשר זמין אינם עוברים לרקע inert.
4. route change ממקד H1 ומעדכן `aria-current` ו־document title.
5. status משמעותי מוכרז פעם אחת בלבד.

### 11.3 Responsive/RTL

1. wide מציג nav קבוע; narrow מציג Menu+drawer בלבד.
2. ב־320 CSS px וב־200% zoom אין overflow אופקי, טקסט חתוך ללא דרך חשיפה, focus מוסתר או action חסרה.
3. HE/RTL ו־EN/LTR משתמשים באותו DOM order; paths/branches/IDs נשארים קריאים.

### 11.4 Authority/security

1. forged/replayed webview confirm או authority field יוצר 0 receipt ו־0 dispatch.
2. DOM modal נסגר לפני native prompt; cancel/dismiss משאיר state ללא שינוי.
3. unknown route נופל ל־Home; malformed/oversized/prototype-polluting messages נדחים.
4. CSP חוסם inline/eval/data/blob/remote/connect/frame/object/worker/form/base וטעינת workspace/global-storage.

### 11.5 Commands/sidebar

1. Commands מציג בדיוק 100 IDs, 25 rows לעמוד ו־`aria-rowcount` מסונן.
2. filter/page/update משמרים focus לפי הכללים לעיל.
3. sidebar אינו מכיל settings forms; partial מופיע רק כאשר provider מפרסם `streamingPartials=true` ולעולם אינו מפעיל command.
4. fresh setup אינו מוריד דבר לפני לחיצה והסכמה מפורשות. modal מציג STT ו־TTS bytes/רישיונות בנפרד ואת combined bytes לפני guided install אחד.
5. STT ו־TTS עוברים install/cancel/retry/remove בנפרד; התקנה של pack אחד אינה משנה את השני. guided install של שניהם מאמת שני SHA-256/byte gates עצמאיים ושומר pack שכבר הותקן אם השני נכשל או בוטל.
6. הסרת STT בלבד משאירה TTS usable; הסרת TTS בלבד משאירה STT usable. remove-both partial failure מדווח לפי pack ואינו מוצג כהצלחה מלאה.
7. UI חוסם כל pack מעל `600,000,000` bytes וכל selection משולב מעל `1,100,000,000` bytes, ומציג exact bytes, combined bytes ו־estimated storage לפני consent.

כל כשל בתרחישים אלה חוסם מעבר למימוש route נוסף או לשחרור.
