/**
 * The public privacy notice (docs/product/04-sitemap.md, `/privacy`), in the
 * three languages of ADR-0027. It is static text: the page reads no cookie,
 * header or database.
 *
 * Every statement here must stay true of the deployed service. Update this
 * file in the same pull request as any change to what data is stored, where
 * it is hosted, which sub-processors are used, or how the AI assistant works.
 *
 * The Greek text needs a native speaker's review, and the whole notice needs
 * legal review, before the first clinic goes live.
 */
export const PRIVACY_OPERATOR = {
  name: 'AHMED JUMA',
  place: { ar: 'سالونيك، اليونان', el: 'Θεσσαλονίκη, Ελλάδα', en: 'Thessaloniki, Greece' },
  email: 'alarapioranse@gmail.com',
} as const;

export const PRIVACY_LAST_UPDATED = '2026-11-11';

export type PrivacyLocale = 'ar' | 'el' | 'en';

export type PrivacySection = { heading: string; paragraphs: string[] };

export type PrivacyNotice = {
  languageName: string;
  direction: 'rtl' | 'ltr';
  title: string;
  updated: string;
  sections: PrivacySection[];
};

const { name, place, email } = PRIVACY_OPERATOR;

export const PRIVACY_NOTICES: Record<PrivacyLocale, PrivacyNotice> = {
  ar: {
    languageName: 'العربية',
    direction: 'rtl',
    title: 'إشعار الخصوصية',
    updated: 'آخر تحديث: 11 نوفمبر 2026',
    sections: [
      {
        heading: 'من نحن',
        paragraphs: [
          `يشغّل هذه الخدمة ${name}، ${place.ar}. للتواصل في أي شأن يخص الخصوصية: ${email}.`,
          'الخدمة حالياً في مرحلة ما قبل الإطلاق: لا تستخدمها أي عيادة بعد، ولا تُعالَج فيها بيانات مرضى حقيقية. يصف هذا الإشعار كيف صُمّمت الخدمة للتعامل مع البيانات، وسيُحدَّث قبل أن تبدأ أول عيادة باستخدامها.',
        ],
      },
      {
        heading: 'من المسؤول عن بياناتك',
        paragraphs: [
          'كل عيادة تستخدم الخدمة هي «المتحكم» في بيانات مرضاها وموظفيها، وهي التي تقرر لماذا وكيف تُستخدم. نحن «معالج» نعمل بتعليمات العيادة وبموجب اتفاقية معالجة بيانات معها.',
          'إن كنت مريضاً في عيادة، فالعيادة هي جهة الاتصال الأولى لأي طلب يخص بياناتك.',
        ],
      },
      {
        heading: 'ما البيانات التي تُخزَّن',
        paragraphs: [
          'بيانات المرضى التي تدخلها العيادة أو تصلها: الاسم، رقم الهاتف، الرسائل المتبادلة مع العيادة، والمواعيد.',
          'بيانات موظفي العيادة: البريد الإلكتروني، كلمة مرور محفوظة بصيغة مشفّرة غير قابلة للاسترجاع، والدور الوظيفي.',
          'مستندات العيادة: ملفات PDF ترفعها العيادة نفسها، مثل قائمة الأسعار وساعات العمل، ليستند إليها المساعد.',
          'بيانات كل عيادة معزولة عن بيانات العيادات الأخرى على مستوى قاعدة البيانات.',
        ],
      },
      {
        heading: 'الذكاء الاصطناعي',
        paragraphs: [
          'الردود الآلية غير مفعّلة حالياً، ولم يُعتمد بعد أي مزوّد لخدمة الذكاء الاصطناعي. سيُذكر المزوّد في هذا الإشعار قبل تفعيل الخدمة لأي عيادة.',
          'عند تفعيل المساعد لعيادة، يكتب مسودات ردود إدارية فقط (مثل المواعيد وساعات العمل والأسعار) اعتماداً على مستندات تلك العيادة، ويراجعها موظف من العيادة ويوافق عليها قبل إرسالها.',
          'المساعد لا يقدّم نصائح طبية ولا تشخيصاً. الأسئلة الطبية تُحال إلى طاقم العيادة.',
          'سيُوضَّح للمريض متى كُتب الرد بمساعدة الذكاء الاصطناعي. ولا تُستخدم بيانات المرضى لتدريب نماذج الذكاء الاصطناعي.',
        ],
      },
      {
        heading: 'أين تُحفظ البيانات ومن يساعدنا في معالجتها',
        paragraphs: [
          'تُحفظ البيانات في مراكز بيانات داخل الاتحاد الأوروبي: التطبيق وقاعدة البيانات في فرانكفورت (ألمانيا)، والملفات المرفوعة في باريس (فرنسا).',
          'المعالجون الفرعيون: Render Services, Inc. (استضافة التطبيق وقاعدة البيانات، منطقة فرانكفورت) و Scaleway SAS (تخزين الملفات، باريس).',
          'لا نبيع البيانات ولا نستخدمها في الإعلانات.',
        ],
      },
      {
        heading: 'ملفات تعريف الارتباط (الكوكيز)',
        paragraphs: [
          'نستخدم ملفين ضروريين فقط: ملف جلسة يُبقي موظف العيادة مسجّل الدخول، وملف يحفظ لغة الواجهة التي اختارها لمدة سنة. لا نستخدم ملفات إعلانية ولا ملفات تتبّع أو تحليلات.',
        ],
      },
      {
        heading: 'مدة الاحتفاظ بالبيانات',
        paragraphs: [
          'تبقى البيانات ما دامت العيادة تستخدم الخدمة، والعيادة هي التي تحدد مدد الاحتفاظ. ستُذكر المدد المحددة في هذا الإشعار قبل أن تبدأ أول عيادة باستخدام الخدمة.',
        ],
      },
      {
        heading: 'حقوقك',
        paragraphs: [
          'بموجب اللائحة العامة لحماية البيانات (GDPR) يحق لك طلب الاطلاع على بياناتك، وتصحيحها، وحذفها، وتقييد معالجتها، ونقلها، والاعتراض على معالجتها.',
          `قدّم طلبك إلى عيادتك، أو راسلنا على ${email} وسنحيله إلى العيادة المعنية.`,
          'يحق لك أيضاً تقديم شكوى إلى الهيئة اليونانية لحماية البيانات (www.dpa.gr) أو إلى هيئة حماية البيانات في بلدك.',
        ],
      },
    ],
  },
  el: {
    languageName: 'Ελληνικά',
    direction: 'ltr',
    title: 'Ενημέρωση για την προστασία δεδομένων',
    updated: 'Τελευταία ενημέρωση: 11 Νοεμβρίου 2026',
    sections: [
      {
        heading: 'Ποιοι είμαστε',
        paragraphs: [
          `Την υπηρεσία λειτουργεί ο ${name}, ${place.el}. Για κάθε θέμα προστασίας δεδομένων: ${email}.`,
          'Η υπηρεσία βρίσκεται σε στάδιο πριν από την έναρξη λειτουργίας: δεν τη χρησιμοποιεί ακόμη κανένα ιατρείο και δεν γίνεται επεξεργασία πραγματικών δεδομένων ασθενών. Η παρούσα ενημέρωση περιγράφει πώς έχει σχεδιαστεί η υπηρεσία να χειρίζεται τα δεδομένα και θα επικαιροποιηθεί πριν τη χρησιμοποιήσει το πρώτο ιατρείο.',
        ],
      },
      {
        heading: 'Ποιος είναι υπεύθυνος για τα δεδομένα σας',
        paragraphs: [
          'Κάθε ιατρείο που χρησιμοποιεί την υπηρεσία είναι ο «υπεύθυνος επεξεργασίας» για τα δεδομένα των ασθενών και του προσωπικού του και αποφασίζει γιατί και πώς χρησιμοποιούνται. Εμείς είμαστε ο «εκτελών την επεξεργασία» και ενεργούμε σύμφωνα με τις οδηγίες του ιατρείου, βάσει σύμβασης επεξεργασίας δεδομένων.',
          'Αν είστε ασθενής ενός ιατρείου, το ιατρείο είναι το πρώτο σημείο επικοινωνίας για κάθε αίτημα σχετικά με τα δεδομένα σας.',
        ],
      },
      {
        heading: 'Ποια δεδομένα αποθηκεύονται',
        paragraphs: [
          'Δεδομένα ασθενών που καταχωρίζει ή λαμβάνει το ιατρείο: όνομα, αριθμός τηλεφώνου, μηνύματα που ανταλλάσσονται με το ιατρείο και ραντεβού.',
          'Δεδομένα προσωπικού του ιατρείου: διεύθυνση email, κωδικός πρόσβασης αποθηκευμένος σε μη αναστρέψιμη κρυπτογραφημένη μορφή και ρόλος.',
          'Έγγραφα του ιατρείου: αρχεία PDF που μεταφορτώνει το ίδιο το ιατρείο, όπως τιμοκατάλογος και ωράριο, στα οποία βασίζεται ο βοηθός.',
          'Τα δεδομένα κάθε ιατρείου είναι απομονωμένα από τα δεδομένα των άλλων ιατρείων σε επίπεδο βάσης δεδομένων.',
        ],
      },
      {
        heading: 'Τεχνητή νοημοσύνη',
        paragraphs: [
          'Οι αυτόματες απαντήσεις δεν είναι ενεργοποιημένες και δεν έχει επιλεγεί ακόμη πάροχος τεχνητής νοημοσύνης. Ο πάροχος θα αναφερθεί σε αυτή την ενημέρωση πριν ενεργοποιηθεί η λειτουργία για οποιοδήποτε ιατρείο.',
          'Όταν ο βοηθός ενεργοποιηθεί για ένα ιατρείο, συντάσσει μόνο προσχέδια διοικητικών απαντήσεων (όπως ραντεβού, ωράριο και τιμές) με βάση τα έγγραφα του συγκεκριμένου ιατρείου· ένα μέλος του προσωπικού τα ελέγχει και τα εγκρίνει πριν σταλούν.',
          'Ο βοηθός δεν παρέχει ιατρικές συμβουλές ούτε διάγνωση. Οι ιατρικές ερωτήσεις παραπέμπονται στο προσωπικό του ιατρείου.',
          'Ο ασθενής θα ενημερώνεται όταν μια απάντηση έχει συνταχθεί με τη βοήθεια τεχνητής νοημοσύνης. Τα δεδομένα των ασθενών δεν χρησιμοποιούνται για την εκπαίδευση μοντέλων τεχνητής νοημοσύνης.',
        ],
      },
      {
        heading: 'Πού φυλάσσονται τα δεδομένα και ποιοι μας βοηθούν',
        paragraphs: [
          'Τα δεδομένα φυλάσσονται σε κέντρα δεδομένων εντός της Ευρωπαϊκής Ένωσης: η εφαρμογή και η βάση δεδομένων στη Φρανκφούρτη (Γερμανία) και τα μεταφορτωμένα αρχεία στο Παρίσι (Γαλλία).',
          'Υπεργολάβοι επεξεργασίας: Render Services, Inc. (φιλοξενία της εφαρμογής και της βάσης δεδομένων, περιοχή Φρανκφούρτης) και Scaleway SAS (αποθήκευση αρχείων, Παρίσι).',
          'Δεν πουλάμε δεδομένα και δεν τα χρησιμοποιούμε για διαφήμιση.',
        ],
      },
      {
        heading: 'Χρήση cookies',
        paragraphs: [
          'Χρησιμοποιούμε μόνο δύο απαραίτητα cookies: ένα cookie συνεδρίας που κρατά συνδεδεμένο το μέλος του προσωπικού και ένα cookie που θυμάται τη γλώσσα που επέλεξε για έναν χρόνο. Δεν χρησιμοποιούμε διαφημιστικά cookies ούτε cookies παρακολούθησης ή στατιστικών.',
        ],
      },
      {
        heading: 'Χρόνος διατήρησης',
        paragraphs: [
          'Τα δεδομένα διατηρούνται όσο το ιατρείο χρησιμοποιεί την υπηρεσία, και το ιατρείο ορίζει τους χρόνους διατήρησης. Οι συγκεκριμένοι χρόνοι θα αναφερθούν σε αυτή την ενημέρωση πριν χρησιμοποιήσει την υπηρεσία το πρώτο ιατρείο.',
        ],
      },
      {
        heading: 'Τα δικαιώματά σας',
        paragraphs: [
          'Σύμφωνα με τον Γενικό Κανονισμό Προστασίας Δεδομένων (GDPR) έχετε δικαίωμα πρόσβασης, διόρθωσης, διαγραφής, περιορισμού της επεξεργασίας, φορητότητας και εναντίωσης.',
          `Υποβάλετε το αίτημά σας στο ιατρείο σας ή γράψτε μας στο ${email} και θα το προωθήσουμε στο αρμόδιο ιατρείο.`,
          'Έχετε επίσης δικαίωμα να υποβάλετε καταγγελία στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (www.dpa.gr) ή στην αρχή προστασίας δεδομένων της χώρας σας.',
        ],
      },
    ],
  },
  en: {
    languageName: 'English',
    direction: 'ltr',
    title: 'Privacy notice',
    updated: 'Last updated: 11 November 2026',
    sections: [
      {
        heading: 'Who we are',
        paragraphs: [
          `This service is operated by ${name}, ${place.en}. For any privacy matter: ${email}.`,
          'The service is in a pre-launch stage: no clinic uses it yet and no real patient data is processed. This notice describes how the service is designed to handle data, and it will be updated before the first clinic starts using it.',
        ],
      },
      {
        heading: 'Who is responsible for your data',
        paragraphs: [
          'Each clinic that uses the service is the "controller" of its patients\' and staff members\' data and decides why and how it is used. We are a "processor": we act on the clinic\'s instructions under a data processing agreement.',
          'If you are a patient of a clinic, the clinic is your first point of contact for any request about your data.',
        ],
      },
      {
        heading: 'What data is stored',
        paragraphs: [
          'Patient data that the clinic enters or receives: name, phone number, messages exchanged with the clinic, and appointments.',
          'Clinic staff data: email address, a password stored in a non-reversible hashed form, and role.',
          'Clinic documents: PDF files the clinic itself uploads, such as a price list and opening hours, which the assistant relies on.',
          "Each clinic's data is isolated from every other clinic's data at the database level.",
        ],
      },
      {
        heading: 'Artificial intelligence',
        paragraphs: [
          'Automatic replies are not switched on, and no AI provider has been selected yet. The provider will be named in this notice before the feature is enabled for any clinic.',
          "When the assistant is enabled for a clinic, it only drafts administrative replies (such as appointments, opening hours and prices) from that clinic's own documents, and a member of the clinic's staff reviews and approves each draft before it is sent.",
          "The assistant does not give medical advice or a diagnosis. Medical questions are passed to the clinic's staff.",
          'Patients will be told when a reply was drafted with the help of AI. Patient data is not used to train AI models.',
        ],
      },
      {
        heading: 'Where data is kept and who helps us process it',
        paragraphs: [
          'Data is kept in data centres inside the European Union: the application and database in Frankfurt (Germany), and uploaded files in Paris (France).',
          'Sub-processors: Render Services, Inc. (hosting of the application and database, Frankfurt region) and Scaleway SAS (file storage, Paris).',
          'We do not sell data or use it for advertising.',
        ],
      },
      {
        heading: 'Cookies',
        paragraphs: [
          'We use only two necessary cookies: a session cookie that keeps a clinic staff member signed in, and a cookie that remembers the interface language they chose for one year. We use no advertising, tracking or analytics cookies.',
        ],
      },
      {
        heading: 'How long data is kept',
        paragraphs: [
          'Data is kept for as long as the clinic uses the service, and the clinic sets the retention periods. The specific periods will be stated in this notice before the first clinic starts using the service.',
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          'Under the General Data Protection Regulation (GDPR) you have the right to access, rectify and erase your data, to restrict its processing, to data portability, and to object.',
          `Send your request to your clinic, or write to us at ${email} and we will pass it to the clinic concerned.`,
          'You also have the right to lodge a complaint with the Hellenic Data Protection Authority (www.dpa.gr) or with the data protection authority of your country.',
        ],
      },
    ],
  },
};

/** The order the languages appear on the page; Arabic first, as the marketing site is Arabic. */
export const PRIVACY_LOCALE_ORDER: readonly PrivacyLocale[] = ['ar', 'el', 'en'];
