# Surfboard Color Studio

אפליקציית Web סטטית לסימון אזורים בתמונת גלשן, החלפת צבעים תוך שמירת הצללות/ברק, ושיתוף פרויקט דרך קישור כך שאדם אחר יוכל לשחק עם הצבעים מהמחשב או מהטלפון.

## מה כבר קיים

- העלאת PNG / JPG / WebP
- יצירת מספר אזורים בלתי מוגבל
- סימון באמצעות Polygon, Brush, Eraser ו-Magic Wand
- Zoom + Pan
- Color picker + HEX + presets + Eyedropper
- שמירת אור/צל של האזור המקורי בזמן שינוי הצבע
- עוצמת צבע ו-Feather לקצוות
- Show/Hide לכל אזור
- Undo / Redo
- שכפול אזור וניקוי מסכה
- השוואה של עד 4 וריאציות
- Export PNG
- גיבוי וייבוא של פרויקט כקובץ JSON
- Cloud Save
- קישור עריכה מלא
- קישור "צביעה בלבד" שמאפשר למקבל לשנות צבעים ולייצא, אך לא לשמור מעל הפרויקט המקורי
- Save as Copy ליצירת עותק ענן עצמאי
- ממשק Responsive למחשב ולטלפון

## ארכיטקטורה

ה-Frontend הוא HTML/CSS/JavaScript רגיל ולכן מתאים ל-GitHub Pages ללא שרת אפליקציה.

לשיתוף בין מכשירים משתמשים ב-Supabase Postgres. התמונה נשמרת כ-Data URL דחוס יחד עם נתוני הפרויקט. אין צורך ב-Supabase Storage ואין צורך בחשבון משתמש לאדם שמקבל את הקישור.

גישה לפרויקט מתבצעת דרך שני tokens בלתי-ניחושים:

- Edit token — סוד אקראי שיכול לטעון ולשמור שינויים.
- View token — נגזר חד-כיוונית מ-Edit token ויכול רק לטעון. ה-UI מאפשר שינוי צבעים מקומי וייצוא, אך RPC השמירה לא יקבל את ה-token הזה.

ה-tokens עצמם לא נשמרים במסד הנתונים; נשמר רק SHA-256 hash שלהם. בנוסף, ה-token נמצא ב-URL fragment (`#t=...`), ולכן GitHub Pages לא מקבל אותו בבקשת HTTP של הדף.

## שלב 1 — יצירת Supabase Project

1. צור Project חדש ב-Supabase.
2. פתח `SQL Editor`.
3. העתק והריץ את כל הקובץ `supabase-setup.sql`.
4. פתח את `Connect` או `Settings -> API Keys` וקח:
   - Project URL
   - Publishable key (או legacy anon key בפרויקט ישן)
5. פתח `config.js` והדבק:

```js
window.SURFBOARD_APP_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseKey: "sb_publishable_..."
};
```

חשוב: השתמש רק ב-Publishable key / anon key בדפדפן. לעולם אל תכניס Secret key או service_role key לקוד ה-Frontend.

## שלב 2 — פרסום ב-GitHub Pages

1. צור Repository חדש ב-GitHub, לדוגמה `surfboard-color-studio`.
2. העלה לתיקיית root את כל הקבצים בתיקייה הזו.
3. ב-GitHub פתח `Settings -> Pages`.
4. תחת `Build and deployment` בחר `Deploy from a branch`.
5. בחר branch `main` ותיקייה `/(root)` ואז Save.
6. לאחר הפרסום תקבל כתובת בסגנון:

```text
https://USERNAME.github.io/surfboard-color-studio/
```

## שימוש מומלץ

1. פתח את האתר.
2. העלה תמונת גלשן.
3. הוסף אזור, למשל `Rails`.
4. סמן אותו עם Polygon / Brush / Magic Wand.
5. הוסף אזורים נוספים כמו `Deck`, `Logo`, `Stripe`.
6. לחץ `שמירה בענן`.
7. לחץ `שיתוף לצביעה` ושלח את הקישור.
8. האדם השני יכול לפתוח את הקישור בטלפון/מחשב, לשנות את הצבע של כל אזור ולייצא PNG. הוא אינו יכול לשמור מעל המקור עם קישור הצביעה.
9. אם הוא רוצה לשמור גרסה משלו בענן, הוא יכול לבחור `שמירה כעותק`.

## פיתוח מקומי

מכיוון שהאתר סטטי, אפשר להריץ אותו עם כל HTTP server פשוט. לדוגמה:

```bash
python3 -m http.server 8080
```

ואז לפתוח:

```text
http://localhost:8080
```

פתיחה ישירה של `index.html` כ-`file://` אינה מומלצת בגלל מגבלות דפדפן על Clipboard/Share וקריאות רשת.

## אבטחה והגבלות

- טבלת הפרויקטים מפעילה Row Level Security ואין ל-`anon`/`authenticated` הרשאות ישירות לטבלה.
- הגישה נעשית רק דרך RPC functions עם token.
- קישור עריכה הוא סוד לכל דבר: מי שמקבל אותו יכול לשנות את הפרויקט. אל תפרסם אותו במקום ציבורי.
- קישור הצביעה משתמש ב-token נפרד שאינו מורשה לבצע Save.
- זה כלי שיתוף קל, לא מערכת ארגונית עם חשבונות, הרשאות צוות או audit logs.
- התמונות נשמרות במסד הנתונים של Supabase. בדוק את מגבלות האחסון של התוכנית שלך אם אתה מתכנן הרבה פרויקטים או תמונות גדולות.

## קבצים

```text
index.html             UI
styles.css             עיצוב Responsive
app.js                 Canvas editor + masks + cloud sharing
config.js              כתובת ומפתח Supabase ציבורי
supabase-setup.sql      טבלה + RPC functions + הרשאות
manifest.webmanifest   metadata להתקנה כ-Web App
.nojekyll               GitHub Pages helper
README.md               הוראות
```
