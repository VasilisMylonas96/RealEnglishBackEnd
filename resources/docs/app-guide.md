# Real English Academy — App Guide / Οδηγός Εφαρμογής

> This document is the **knowledge base** for the in-app AI assistant.
> It describes what the platform does, who uses it, where every feature
> lives (URL routes), and step-by-step how to perform each action.
> Keep it in sync with the frontend whenever routes or features change.

---

## 1. What is the platform? / Τι είναι η πλατφόρμα;

**Real English Academy** is an online learning platform for an English
language school. It combines a public marketing website with a private
student/teacher area where lessons, quizzes, tournaments, video calls,
scheduling and messaging happen.

Η **Real English Academy** είναι μια πλατφόρμα διαδικτυακής εκπαίδευσης
για μια σχολή αγγλικής γλώσσας. Συνδυάζει έναν δημόσιο ιστότοπο
παρουσίασης με έναν ιδιωτικό χώρο μαθητών/καθηγητών, όπου γίνονται
μαθήματα, κουίζ, διαγωνισμοί, βιντεοκλήσεις, προγραμματισμός και
αλληλογραφία.

---

## 2. User roles / Ρόλοι χρηστών

| Role / Ρόλος | Who / Ποιος | Main capabilities / Βασικές δυνατότητες |
|---|---|---|
| **Visitor / Επισκέπτης** | Anyone without an account / Όποιος δεν έχει λογαριασμό | Browse the public website, view the AI assistant. / Περιήγηση στον δημόσιο ιστότοπο, χρήση του AI βοηθού. |
| **Student / Μαθητής** | A learner / Ένας μαθητής | Quizzes, leaderboard, tournaments, my calendar, video calls, chat, profile. / Κουίζ, κατάταξη, διαγωνισμοί, το ημερολόγιό μου, βιντεοκλήσεις, chat, προφίλ. |
| **Teacher / Καθηγητής** | A teacher / Ένας καθηγητής | Everything a student can do, plus: manage calendar groups & events, manage video calls, invite students, student management. / Ό,τι κάνει ο μαθητής, συν: διαχείριση ομάδων & γεγονότων ημερολογίου, διαχείριση βιντεοκλήσεων, προσκλήσεις μαθητών, διαχείριση μαθητών. |
| **Admin / Διαχειριστής** | School admin / Διαχειριστής σχολής | Everything a teacher can do, plus: edit site content (Edit Mode), invite dashboard, full student management. / Ό,τι κάνει ο καθηγητής, συν: επεξεργασία περιεχομένου ιστοτόπου (Edit Mode), πίνακας προσκλήσεων, πλήρης διαχείριση μαθητών. |

Roles are hierarchical: **Admin > Teacher > Student**.
Οι ρόλοι είναι ιεραρχικοί: **Διαχειριστής > Καθηγητής > Μαθητής**.

---

## 3. Public website (no login required) / Δημόσιος ιστότοπος (χωρίς σύνδεση)

These pages are visible to everyone. The top navigation bar links to them.
Αυτές οι σελίδες είναι ορατές σε όλους. Η επάνω μπάρα πλοήγησης οδηγεί σε αυτές.

| Page / Σελίδα | URL / Route | Description / Περιγραφή |
|---|---|---|
| Home / Αρχική | `/` (or `/HomePage`) | Landing page with school intro, features and call-to-action. / Αρχική σελίδα με εισαγωγή σχολής, λειτουργίες και κλήση δράσης. |
| About Us / Σχετικά με εμάς | `/AboutUs` | Information about the school. / Πληροφορίες για τη σχολή. |
| Our Teachers / Οι Καθηγητές μας | `/OurTeachers` | Profiles of the teaching staff. / Προφίλ του διδακτικού προσωπικού. |
| Our School / Η Σχολή μας | `/OurSchool` | About the school facilities and approach. / Για τις εγκαταστάσεις και την προσέγγιση της σχολής. |
| The Bilingual Project / Το Διγλωσσικό Πρόγραμμα | `/BilingualProject` | Information about the bilingual program. / Πληροφορίες για το διγλωσσικό πρόγραμμα. |
| Gallery / Γκαλερί | `/Gallery` | Photo gallery of the school. / Φωτογραφική γκαλερί της σχολής. |
| Reviews / Κριτικές | `/Reviews` | Google reviews and rating. / Κριτικές και αξιολόγηση Google. |
| ELT Excellence Awards / Βραβεία | `/ELT-ExcellenceAwards` | Awards and recognitions. / Βραβεία και αναγνωρίσεις. |

### How to register / Πώς εγγράφεσαι
Registration is **invite-only**. A teacher or admin creates an invite and
sends it by email. The invite email contains a link like
`/register?token=...`. Opening that link opens the registration form.
Η εγγραφή γίνεται **μόνο με πρόσκληση**. Ένας καθηγητής ή διαχειριστής
δημιουργεί πρόσκληση και την στέλνει με email. Το email πρόσκλησης
περιέχει σύνδεσμο της μορφής `/register?token=...`. Ανοίγοντας αυτόν τον
σύνδεσμο εμφανίζεται η φόρμα εγγραφής.

**Step by step / Βήμα-προς-βήμα:**
1. Open the invite link from the email you received. / Άνοιξε τον σύνδεσμο πρόσκλησης από το email που έλαβες.
2. Fill in your details (name, birth date, username, email, password, level). / Συμπλήρωσε τα στοιχεία σου (όνομα, ημερομηνία γέννησης, όνομα χρήστη, email, κωδικός, επίπεδο).
3. Optionally upload a profile photo. / Προαιρετικά ανέβασε φωτογραφία προφίλ.
4. Submit the form — you are logged in automatically and land on the home page. / Υπόστησε τη φόρμα — συνδέεσαι αυτόματα και φτάνεις στην αρχική σελίδα.

### How to log in / Πώς συνδέεσαι
1. On the public site, click the **Login** button (top-right of the navbar). / Στον δημόσιο ιστότοπο, πάτα το κουμπί **Login** (πάνω δεξιά στη μπάρα).
2. Enter your username and password. / Δώσε όνομα χρήστη και κωδικό.
3. You are redirected into the app area. / Ανακατευθύνεσαι στον χώρο της εφαρμογής.

---

## 4. App area (logged in) / Χώρος εφαρμογής (συνδεδεμένος χρήστης)

When logged in, a **left sidebar** (the "Admin Bar") appears with the main
navigation. The current user's avatar at the top of the sidebar links to
the Profile page.
Όταν είσαι συνδεδεμένος, εμφανίζεται μια **αριστερή μπάρα πλοήγησης**
(Admin Bar) με τις κύριες επιλογές. Το avatar του χρήστη στην κορυφή της
μπαράς οδηγεί στη σελίδα Προφίλ.

| Feature / Λειτουργία | URL / Route | Who / Ποιος | Description / Περιγραφή |
|---|---|---|---|
| Home / Αρχική | `/` | Everyone / Όλοι | Back to the landing page. / Επιστροφή στην αρχική σελίδα. |
| Calendar / Ημερολόγιο | `/calendar` | Teacher, Admin / Καθηγητής, Διαχειριστής | Manage calendar groups and schedule events. / Διαχείριση ομάδων ημερολογίου και προγραμματισμός γεγονότων. |
| My Calendar / Το Ημερολόγιό μου | `/calendar` | Student / Μαθητής | View the events you are invited to. / Δες τα γεγονότα στα οποία έχεις προσκληθεί. |
| Video Calls / Βιντεοκλήσεις | `/dashboard/video-calls/manage` | Teacher, Admin / Καθηγητής, Διαχειριστής | Create and manage video call sessions. / Δημιουργία και διαχείριση συνεδριών βιντεοκλήσης. |
| Video Call Room / Χώρος Βιντεοκλήσης | `/video-calls/room/:callId` | Invited users / Προσκλημένοι χρήστες | The live video call room (Jitsi). / Ο ζωντανός χώρος βιντεοκλήσης (Jitsi). |
| Quizzes / Κουίζ | `/quiz` | Everyone / Όλοι | Take quizzes, see history and review answers. / Κάνε κουίζ, δες ιστορικό και επαναξιολόγησε απαντήσεις. |
| Leaderboard / Κατάταξη | `/leaderboard` | Everyone / Όλοι | Rankings and hall of fame. / Κατατάξεις και αίθουσα των διάσημων. |
| Tournaments / Διαγωνισμοί | `/tournaments` | Everyone / Όλοι | Bracket tournaments and matches. / Διαγωνισμοί με bracket και αγώνες. |
| Students / Μαθητές | `/students` | Teacher, Admin / Καθηγητής, Διαχειριστής | Manage students (search, levels, passwords). / Διαχείριση μαθητών (αναζήτηση, επίπεδα, κωδικοί). |
| Profile / Προφίλ | `/profile` | Everyone / Όλοι | View and edit your profile, change password. / Δες και επεξεργαστείτε το προφίλ σου, άλλαξε κωδικό. |

---

## 5. Feature-by-feature instructions / Οδηγίες ανά λειτουργία

### 5.1 Quizzes / Κουίζ
**Where / Πού:** Sidebar → **Quizzes** → `/quiz`
**Step by step / Βήμα-προς-βήμα:**
1. Open the **Quizzes** page from the sidebar. / Άνοιξε τη σελίδα **Quizzes** από τη μπάρα.
2. Pick an available quiz type and start it. / Επίλεξε ένα διαθέσιμο κουίζ και ξεκίνα το.
3. Answer the questions and submit. / Απάντησε στις ερωτήσεις και υπόστησε.
4. See your score, and review your answers under **History**. / Δες το σκορ σου και επαναξιολόγησε τις απαντήσεις στο **History**.

### 5.2 Leaderboard / Κατάταξη
**Where / Πού:** Sidebar → **Leaderboard** → `/leaderboard`
**Step by step / Βήμα-προς-βήμα:**
1. Open the **Leaderboard** page. / Άνοιξε τη σελίδα **Leaderboard**.
2. Browse the rankings by type and the hall of fame. / Περιηγήσου στις κατατάξεις ανά τύπο και στην αίθουσα των διάσημων.

### 5.3 Tournaments / Διαγωνισμοί
**Where / Πού:** Sidebar → **Tournaments** → `/tournaments`
**Step by step / Βήμα-προς-βήμα:**
1. Open the **Tournaments** page. / Άνοιξε τη σελίδα **Tournaments**.
2. Join a tournament and follow the bracket. / Συμμετείχε σε διαγωνισμό και ακολούθησε το bracket.
3. Teachers/admins can create tournaments, add participants, generate the
   bracket, start matches and submit results. / Οι καθηγητές/διαχειριστές μπορούν να δημιουργήσουν διαγωνισμούς, να προσθέσουν συμμετέχοντες, να δημιουργήσουν bracket, να ξεκινήσουν αγώνες και να υποβάλουν αποτελέσματα.

### 5.4 Calendar / Ημερολόγιο
**Where / Πού:** Sidebar → **Calendar** (teacher/admin) or **My Calendar** (student) → `/calendar`

**For teachers/admins / Για καθηγητές/διαχειριστές:**
1. Open the **Calendar** page. / Άνοιξε τη σελίδα **Calendar**.
2. Create or manage calendar groups. / Δημιούργησε ή διαχειρίσου ομάδες ημερολογίου.
3. Create events and invite students to them. / Δημιούργησε γεγονότα και πρόσκλησε μαθητές σε αυτά.

**For students / Για μαθητές:**
1. Open **My Calendar** from the sidebar. / Άνοιξε το **My Calendar** από τη μπάρα.
2. See the events you have been invited to. / Δες τα γεγονότα στα οποία έχεις προσκληθεί.

### 5.5 Video calls / Βιντεοκλήσεις
**Where / Πού:** Sidebar → **Video Calls** → `/dashboard/video-calls/manage` (teacher/admin)

**Step by step / Βήμα-προς-βήμα:**
1. Open the **Video Calls** management page. / Άνοιξε τη σελίδα διαχείρισης **Video Calls**.
2. Create a video call session and invite participants. / Δημιούργησε μια συνεδρία βιντεοκλήσης και πρόσκλησε συμμετέχοντες.
3. Participants receive an email with a join link. / Οι συμμετέχοντες λαμβάνουν email με σύνδεσμο συμμετοχής.
4. Open the join link to enter the live room (`/video-calls/room/:callId`). / Άνοιξε τον σύνδεσμο για να μπεις στον ζωντανό χώρο.
5. The host can end the call or resend the invitation emails. / Ο οικοδεσπότης μπορεί να τερματίσει την κλήση ή να ξαναστείλει τα emails πρόσκλησης.

### 5.6 Chat / Αλληλογραφία
**Where / Πού:** The floating **chat bubble** at the bottom-right of the
screen (Messenger-style). / Το επιπλέον **κουμπί chat** κάτω δεξιά στην οθόνη.

**Step by step / Βήμα-προς-βήμα:**
1. Click the chat bubble to open the contacts drawer. / Πάτα το κουμπί chat για να ανοίξει η λίστα επαφών.
2. Pick a contact to open a 1-to-1 chat, or open a group chat. / Επίλεξε μια επαφή για 1-προς-1 chat ή άνοιξε group chat.
3. Type a message and send it. You can attach photos, PDF and Word files. / Γράψε ένα μήνυμα και στείλε το. Μπορείς να συνδέσεις φωτογραφίες, PDF και αρχεία Word.
4. Up to 4 chat windows can be open at once. / Μπορούν να είναι ανοιχτά έως 4 παράθυρα chat ταυτόχρονα.

> **Note:** The chat bubble is for **messaging other people** on the
> platform. The **AI assistant** (a separate robot icon) is for asking
> questions about how to use the platform. / **Σημείωση:** Το κουμπί chat
> είναι για **αλληλογραφία με άλλους χρήστες**. Ο **AI βοηθός** (ένα
> ξεχωριστό εικονίδιο ρομπότ) είναι για ερωτήσεις για τη χρήση της
> πλατφόρμας.

### 5.7 Notifications / Ειδοποιήσεις
**Where / Πού:** The **bell icon** in the left sidebar. / Το εικονίδιο
**καμπάνας** στην αριστερή μπάρα.
**Step by step / Βήμα-προς-βήμα:**
1. Click the bell icon to see your notifications. / Πάτα το εικονίδιο καμπάνας για να δεις τις ειδοποιήσεις σου.
2. Click a notification to open the related page. / Πάτα μια ειδοποίηση για να ανοίξει η σχετική σελίδα.
3. Mark one as read, or mark all as read. / Σήμανε μία ως αναγνωσμένη ή όλες ως αναγνωσμένες.

### 5.8 Profile / Προφίλ
**Where / Πού:** Click your **avatar** at the top of the sidebar, or
Sidebar → **Profile** → `/profile`
**Step by step / Βήμα-προς-βήμα:**
1. Open the **Profile** page. / Άνοιξε τη σελίδα **Profile**.
2. Edit your details (name, level, photo, etc.). / Επεξεργαστείτε τα στοιχεία σου (όνομα, επίπεδο, φωτογραφία κ.λπ.).
3. Change your password from the profile settings. / Άλλαξε τον κωδικό σου από τις ρυθμίσεις προφίλ.

### 5.9 Student management / Διαχείριση μαθητών (teacher/admin)
**Where / Πού:** Sidebar → **Students** → `/students`
**Step by step / Βήμα-προς-βήμα:**
1. Open the **Students** page. / Άνοιξε τη σελίδα **Students**.
2. Search for a student by name or filter by level. / Ψάξε έναν μαθητή με όνομα ή φίλτραρε ανά επίπεδο.
3. Open a student to view details, change their level, or reset/set their
   password. / Άνοιξε έναν μαθητή για να δεις λεπτομέρειες, να αλλάξεις το επίπεδό του ή να επαναφέρεις/ορίσεις τον κωδικό του.

### 5.10 Invites / Προσκλήσεις (teacher/admin)
**Where / Πού:** Sidebar → **Invites** button (opens a modal). / Μπάρα →
κουμπί **Invites** (ανοίγει ένα παράθυρο).
**Step by step / Βήμα-προς-βήμα:**
1. Click the **Invites** button in the sidebar. / Πάτα το κουμπί **Invites** στη μπάρα.
2. Create an invite for a new student. / Δημιούργησε μια πρόσκληση για έναν νέο μαθητή.
3. The invite is sent by email with a registration link. / Η πρόσκληση στέλνεται με email με σύνδεσμο εγγραφής.

### 5.11 Edit Mode (admin only) / Λειτουργία επεξεργασίας (μόνο διαχειριστής)
**Where / Πού:** Sidebar → **Edit Mode** toggle (admin only). / Μπάρα →
διακόπτης **Edit Mode** (μόνο διαχειριστής).
**Step by step / Βήμα-προς-βήμα:**
1. Click the **Edit Mode** toggle in the sidebar. / Πάτα τον διακόπτη **Edit Mode** στη μπάρα.
2. Edit page content directly on the page. / Επεξεργαστείτε το περιεχόμενο της σελίδας απευθείας.
3. Click **Save** to publish your changes. / Πάτα **Save** για να δημοσιεύσεις τις αλλαγές σου.

---

## 6. The AI assistant / Ο AI βοηθός

The **AI assistant** is a small robot icon that helps you understand how to
use the platform. It is **separate from the chat** (which is for messaging
other people).
Ο **AI βοηθός** είναι ένα μικρό εικονίδιο ρομπότ που σε βοηθά να καταλάβεις
πώς να χρησιμοποιήσεις την πλατφόρμα. Είναι **ξεχωριστός από το chat**
(που είναι για αλληλογραφία με άλλους).

- **For visitors (no account):** the robot icon appears at the **bottom-right**
  of the screen. / **Για επισκέπτες (χωρίς λογαριασμό):** το εικονίδιο ρομπότ
  εμφανίζεται **κάτω δεξιά** στην οθόνη.
- **For logged-in users:** the robot icon appears **next to the chat (messages)
  icon** at the bottom-right. / **Για συνδεδεμένους χρήστες:** το εικονίδιο
  ρομπότ εμφανίζεται **δίπλα στο εικονίδιο chat (μηνυμάτων)** κάτω δεξιά.
- Click the robot icon to open the assistant window, type your question, and
  get a short, friendly answer. When the assistant mentions a page, you can
  click the link to go there directly. / Πάτα το εικονίδιο ρομπότ για να
  ανοίξει το παράθυρο βοηθού, γράψε την ερώτησή σου και λάβε μια σύντομη,
  φιλική απάντηση. Όταν ο βοηθός αναφέρει μια σελίδα, μπορείς να πατήσεις
  τον σύνδεσμο για να πας απευθείας εκεί.

**Example questions / Παραδείγματα ερωτήσεων:**
- "Πώς κλείνω μάθημα;" / "How do I book a lesson?"
- "Πού βλέπω το πρόγραμμά μου;" / "Where do I see my schedule?"
- "Πώς κάνω κουίζ;" / "How do I take a quiz?"
- "Πώς στέλνω μήνυμα σε κάποιον;" / "How do I message someone?"
