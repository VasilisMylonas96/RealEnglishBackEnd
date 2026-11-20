/* eslint-disable no-console */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

/**
 * Seeds:
 *  1. Default admin user: mariaMarkou / 123 (bcrypt-hashed)
 *  2. Default PageContents for the main pages (home, about, ourschool, awards, gallery)
 */
async function main() {
  // --- Admin user ---
  const existingAdmin = await prisma.user.findUnique({ where: { username: 'mariaMarkou' } });
  if (!existingAdmin) {
    const hash = await bcrypt.hash('123', 10);
    await prisma.user.create({
      data: {
        username: 'mariaMarkou',
        password: hash,
        role: 'ADMIN',
        firstName: 'Maria',
        lastName: 'Markou',
        email: 'maria@realenglish.com',
      },
    });
    console.log('Seeded admin user: mariaMarkou');
  } else {
    // Backfill new fields on the existing admin row (idempotent).
    await prisma.user.update({
      where: { username: 'mariaMarkou' },
      data: {
        firstName: existingAdmin.firstName || 'Maria',
        lastName: existingAdmin.lastName || 'Markou',
        email: existingAdmin.email || 'maria@realenglish.com',
      },
    });
    console.log('Admin user already exists, backfilled profile fields');
  }

  // --- Default page contents ---
  const defaults = [
    // Home page - Hero
    { page_key: 'home', element_id: 'hero_title_prefix', content: 'Welcome to' },
    { page_key: 'home', element_id: 'hero_title_suffix', content: 'English Academy!' },
    { page_key: 'home', element_id: 'hero_subtitle', content: 'Where English isn’t just taught—it’s lived. Step into a world of interactive learning, expert guidance, and award-winning facilities.' },
    { page_key: 'home', element_id: 'hero_button', content: 'Learn More About Us' },
    { page_key: 'home', element_id: 'hero_background', content: '' }, // empty = bundled fallback image
    // Home page - Our Vision
    { page_key: 'home', element_id: 'vision_title', content: 'Our Vision for Education' },
    { page_key: 'home', element_id: 'vision_subtitle', content: 'We reimagine traditional classrooms, creating dynamic, student-centered environments where curiosity and creativity thrive.' },
    { page_key: 'home', element_id: 'vision_card_1_title', content: 'Flexible Seating' },
    { page_key: 'home', element_id: 'vision_card_1_desc', content: 'Our classrooms feature adaptable seating arrangements to encourage collaboration and comfort.' },
    { page_key: 'home', element_id: 'vision_card_2_title', content: 'Interactive Technology' },
    { page_key: 'home', element_id: 'vision_card_2_desc', content: 'State-of-the-art tools and devices to enhance engagement and learning outcomes.' },
    { page_key: 'home', element_id: 'vision_card_3_title', content: 'Creative Learning' },
    { page_key: 'home', element_id: 'vision_card_3_desc', content: 'Montessori-inspired settings that foster curiosity, creativity, and joy in learning.' },
    { page_key: 'home', element_id: 'vision_button', content: 'Discover Our School' },
    // Home page - Award
    { page_key: 'home', element_id: 'award_title', content: 'ELT Excellence Award 2024' },
    { page_key: 'home', element_id: 'award_subtitle', content: 'Recognized for our outstanding facilities and innovative learning environment.' },
    { page_key: 'home', element_id: 'award_button', content: 'Discover Our Excellence' },
    // Home page - Bilingual Project
    { page_key: 'home', element_id: 'bilingual_title', content: 'The Bilingual Project' },
    { page_key: 'home', element_id: 'bilingual_subtitle', content: 'Immersive English learning for children aged 3-6 through music, storytelling, and interactive play.' },
    { page_key: 'home', element_id: 'bilingual_card_1_title', content: 'Music & Rhythm' },
    { page_key: 'home', element_id: 'bilingual_card_1_title_back', content: 'Music & Rhythm' },
    { page_key: 'home', element_id: 'bilingual_card_1_desc', content: 'Children learn English through songs and rhythmic activities.' },
    { page_key: 'home', element_id: 'bilingual_card_2_title', content: 'Storytelling' },
    { page_key: 'home', element_id: 'bilingual_card_2_title_back', content: 'Storytelling' },
    { page_key: 'home', element_id: 'bilingual_card_2_desc', content: 'Engaging stories that make learning English fun and memorable.' },
    { page_key: 'home', element_id: 'bilingual_card_3_title', content: 'Interactive Play' },
    { page_key: 'home', element_id: 'bilingual_card_3_title_back', content: 'Interactive Play' },
    { page_key: 'home', element_id: 'bilingual_card_3_desc', content: 'Hands-on activities that encourage creativity and communication.' },
    { page_key: 'home', element_id: 'bilingual_button', content: 'Explore the Bilingual Project' },
    // Home page - Our School ("At [logo] English Academy")
    { page_key: 'home', element_id: 'home_ourschool_title_prefix', content: 'At' },
    { page_key: 'home', element_id: 'home_ourschool_title_suffix', content: 'English Academy' },
    { page_key: 'home', element_id: 'home_ourschool_p1', content: 'we believe English isn’t just something you study—it’s something you experience!' },
    { page_key: 'home', element_id: 'home_ourschool_card_1_title', content: 'Interactive Learning' },
    { page_key: 'home', element_id: 'home_ourschool_card_1_desc', content: 'Hands-on activities and games that make learning fun and natural.' },
    { page_key: 'home', element_id: 'home_ourschool_card_2_title', content: 'Expert Instructors' },
    { page_key: 'home', element_id: 'home_ourschool_card_2_desc', content: 'Certified teachers with years of experience in language education.' },
    { page_key: 'home', element_id: 'home_ourschool_card_3_title', content: 'Award-Winning Facilities' },
    { page_key: 'home', element_id: 'home_ourschool_card_3_desc', content: 'Recognized for our innovative and vibrant learning spaces.' },
    // About Us
    { page_key: 'about', element_id: 'title', content: 'About Us' },
    { page_key: 'about', element_id: 'welcome', content: 'Welcome to Real English Academy' },
    { page_key: 'about', element_id: 'title_prefix', content: 'At' },
    { page_key: 'about', element_id: 'title_suffix', content: 'English Academy' },
    { page_key: 'about', element_id: 'welcome_p1', content: 'we believe English isn’t just something you study—it’s something you <span class="text-info">experience!</span>' },
    { page_key: 'about', element_id: 'welcome_p2', content: 'That’s why our approach is different. We don’t just teach grammar; we bring English to life through communication, hands-on activities, and interactive games that make learning fun, engaging, and natural.' },
    { page_key: 'about', element_id: 'feature_1', content: 'Interactive Learning' },
    { page_key: 'about', element_id: 'feature_1_desc', content: 'Hands-on activities and games that make learning fun and natural.' },
    { page_key: 'about', element_id: 'feature_2', content: 'Expert Instructors' },
    { page_key: 'about', element_id: 'feature_2_desc', content: 'Certified teachers with years of experience in language education.' },
    { page_key: 'about', element_id: 'feature_3', content: 'Award-Winning Facilities' },
    { page_key: 'about', element_id: 'feature_3_desc', content: 'Recognized for our innovative and vibrant learning spaces.' },
    { page_key: 'about', element_id: 'welcome_p3', content: 'Our commitment to innovation was recognized with the <strong class="ps-1 text-primary">Excellence in School Facilities</strong> award in 2024, celebrating our vibrant learning spaces designed to spark curiosity, creativity, and confidence.' },
    // About Us - New Way to Learn English
    { page_key: 'about', element_id: 'newway_title', content: 'A New Way to Learn English' },
    { page_key: 'about', element_id: 'newway_intro', content: 'We are the exclusive partner of two cutting-edge learning programs:' },
    { page_key: 'about', element_id: 'newway_steam_title', content: 'The STEAM Network:' },
    { page_key: 'about', element_id: 'newway_steam_desc', content: 'Junior students explore Science, Technology, Engineering, Arts, and Mathematics through exciting projects and experiments. This hands-on approach not only makes learning fun but also helps them develop English skills in a meaningful, real-world context.' },
    { page_key: 'about', element_id: 'newway_drama_title', content: 'The English Drama Method:' },
    { page_key: 'about', element_id: 'newway_drama_desc', content: 'Available for all levels, this unique method transforms English learning into an adventure with acting games, role-playing, and storytelling. Students gain fluency, confidence, and creativity—all while having fun!' },
    // Global page background (shared by AboutUs, OurSchool, Gallery, etc.)
    { page_key: 'global', element_id: 'page_background', content: '' }, // empty = bundled RealEnglishLamb3.png
    { page_key: 'about', element_id: 'newway_steam_image', content: '' }, // empty = bundled SteamLogo.png
    { page_key: 'about', element_id: 'newway_drama_image', content: '' }, // empty = bundled dramaLogo.png
    // Our School
    { page_key: 'ourschool', element_id: 'title', content: 'Our School' },
    { page_key: 'ourschool', element_id: 'paragraph_1', content: 'Our vision reimagines traditional classrooms, creating dynamic, student-centered environments. The results speak volumes: increased engagement, collaboration, and joy in learning.' },
    { page_key: 'ourschool', element_id: 'paragraph_2', content: 'With flexible seating, interactive technology, and Montessori-inspired settings, students thrive. Our approach enhances learning outcomes and cultivates a culture of curiosity and creativity.' },
    { page_key: 'ourschool', element_id: 'paragraph_3', content: 'Through innovative design and pedagogy, we’re shaping the future of education—one vibrant classroom at a time!' },
    { page_key: 'ourschool', element_id: 'feature_1', content: 'Flexible Seating' },
    { page_key: 'ourschool', element_id: 'feature_2', content: 'Interactive Technology' },
    { page_key: 'ourschool', element_id: 'feature_3', content: 'ELT Excellence Award 2024' },
    // Awards page
    { page_key: 'awards', element_id: 'title', content: 'ELT Excellence Awards 2024' },
    { page_key: 'awards', element_id: 'intro', content: 'The ELT Excellence Awards honour excellence in English language teaching and learning offered by Private Primary and Secondary Schools, State Primary and Secondary Schools, as well as by Foreign Language Schools in Greece and Cyprus.' },
    { page_key: 'awards', element_id: 'award_card_title', content: 'Real English Academy Received an Award!' },
    { page_key: 'awards', element_id: 'award_card_description', content: '“This award celebrates schools that are safe, with pleasantly decorated classrooms, and unconventional classroom layouts that allow students to move freely, communicate, and collaborate with their peers, and enjoy learning in a happy atmosphere.”' },
    { page_key: 'awards', element_id: 'award_2024_description', content: 'We are proud to provide an innovative, comfortable, and stimulating environment for all our students.' },
    { page_key: 'awards', element_id: 'home_like_title', content: 'At REAL, We Foster a Home-Like Environment' },
    // Gallery
    { page_key: 'gallery', element_id: 'title', content: 'Gallery' },
    // Teachers
    { page_key: 'teachers', element_id: 'title', content: 'Meet Our Teachers' },
    { page_key: 'teachers', element_id: 'intro', content: 'At Real English Academy, we believe that great teaching comes from passion, expertise, and continuous learning. Our teachers are dedicated to making English a natural and enjoyable experience for every student.' },
    { page_key: 'teachers', element_id: 'founder_title', content: 'About Our Founder' },
    { page_key: 'teachers', element_id: 'founder_p1', content: 'Our lead educator and founder brings a wealth of experience and a deep love for teaching. With a degree from the English School of the Aristotle University of Thessaloniki and Erasmus studies in Ireland, she has gained international insights into language learning.' },
    { page_key: 'teachers', element_id: 'founder_p2', content: 'Her commitment to innovative education is evident through numerous specialized seminars, including extensive training in teaching English to students with dyslexia. She has also participated in a Teacher’s Retreat, working alongside two of Greece’s most renowned English educators to refine advanced teaching methodologies.' },
    { page_key: 'teachers', element_id: 'founder_p3', content: 'With a focus on interactive, immersive, and engaging lessons, she ensures that every student at Real English Academy learns English in a way that feels natural, practical, and fun!' },
    // Reviews
    { page_key: 'reviews', element_id: 'title', content: 'Hear From Our Happy Students!' },
    { page_key: 'reviews', element_id: 'review_1_text', content: 'Η εμπειρία μου στο Real English Academy ήταν πραγματικά εξαιρετική! Η Μαρία με βοήθησε να βελτιώσω τις γλωσσικές μου δεξιότητες με έναν τρόπο διαδραστικό και ευχάριστο. Με τις καινοτόμες μεθόδους διδασκαλίας της, η εκμάθηση των Αγγλικών έγινε μια απολαυστική εμπειρία γεμάτη αυτοπεποίθηση και δημιουργικότητα. Τη συνιστώ ανεπιφύλακτα!' },
    { page_key: 'reviews', element_id: 'review_2_text', content: 'Συγχαρητήρια για τον Χρήστο!! Είμαστε σε ένα camping και ο Χρήστος μιλάει με ένα κοριτσάκι αγγλικά!!! Έπαθα την πλάκα μου!!!' },
    { page_key: 'reviews', element_id: 'review_3_text', content: 'Όταν το πάθος για την διδασκαλία των αγγλικών συναντά την αληθινή αγάπη για τα παιδιά το αποτέλεσμα είναι μοναδικό. Είμαστε ευγνώμονες για την πολύτιμη μάθηση και από καρδιάς ευχαριστούμε για όλα ❤️' },
    // Bilingual Project page
    { page_key: 'bilingual', element_id: 'title', content: 'The Bilingual Project' },
    { page_key: 'bilingual', element_id: 'logo_left', content: '' }, // empty = bundled BILINGUALPROJECT2.png
    { page_key: 'bilingual', element_id: 'logo_right', content: '' }, // empty = bundled BILINGUALPROJECT1.png
    { page_key: 'bilingual', element_id: 'paragraph_1', content: 'For our youngest learners (ages 3-6), The Bilingual Project offers a fully immersive experience where children acquire English naturally, just like a first language.' },
    { page_key: 'bilingual', element_id: 'paragraph_2', content: 'Through <span class="text-primary">music</span>, <span class="text-success">storytelling</span>, and <span class="text-danger">interactive play</span>, they absorb English effortlessly and begin communicating with confidence.' },
    { page_key: 'bilingual', element_id: 'feature_1', content: 'Music & Rhythm' },
    { page_key: 'bilingual', element_id: 'feature_2', content: 'Storytelling' },
    { page_key: 'bilingual', element_id: 'feature_3', content: 'Interactive Play' },
    { page_key: 'bilingual', element_id: 'paragraph_3', content: 'At <strong class="text-info">Real English Academy</strong>, we focus on real communication for real life. Our students don’t just memorize English—they use it naturally and confidently in everyday situations.' },
    { page_key: 'bilingual', element_id: 'paragraph_4', content: 'Join us and experience a truly immersive way to learn!' },
    // Footer
    { page_key: 'footer', element_id: 'footer_logo', content: '' }, // empty = bundled REALLogoTR.png
    { page_key: 'footer', element_id: 'tagline_1', content: 'For happy students who embrace the joy of learning and want to return for more.' },
    { page_key: 'footer', element_id: 'tagline_2', content: 'Your gateway to a Real-World grasp of English.' },
    { page_key: 'footer', element_id: 'contact_address', content: 'Address: Averof 5, Édessa, Greece 58200' },
    { page_key: 'footer', element_id: 'contact_phone', content: 'Phone: +030 238130 2089' },
    { page_key: 'footer', element_id: 'contact_email', content: 'E-mail: realenglished@gmail.com' },
    { page_key: 'footer', element_id: 'contact_hours', content: 'Operating Hours: 11:00 AM - 9:00 PM' },
    { page_key: 'footer', element_id: 'facebook_url', content: 'https://www.facebook.com/realeglishedessa' },
    { page_key: 'footer', element_id: 'instagram_url', content: 'https://www.instagram.com/real.englishacademy/' },
  ];

  for (const d of defaults) {
    await prisma.pageContents.upsert({
      where: { page_key_element_id: { page_key: d.page_key, element_id: d.element_id } },
      create: d,
      update: {}, // keep existing values if already present
    });
  }
  console.log(`Seeded ${defaults.length} page content elements`);

  // --- In-house (site) reviews ---
  const reviewCount = await prisma.review.count();
  if (reviewCount === 0) {
    const reviews = [
      {
        author: 'Βασίλης Μ',
        rating: 5,
        text: 'Η εμπειρία μου στο Real English Academy ήταν πραγματικά εξαιρετική! Η Μαρία με βοήθησε να βελτιώσω τις γλωσσικές μου δεξιότητες με έναν τρόπο διαδραστικό και ευχάριστο. Με τις καινοτόμες μεθόδους διδασκαλίας της, η εκμάθηση των Αγγλικών έγινε μια απολαυστική εμπειρία γεμάτη αυτοπεποίθηση και δημιουργικότητα. Τη συνιστώ ανεπιφύλακτα!',
        reviewDate: new Date('2023-11-12'),
        sortOrder: 1,
      },
      {
        author: 'Αλέξανδρος Σ',
        rating: 5,
        text: 'Συγχαρητήρια για τον Χρήστο!! Είμαστε σε ένα camping και ο Χρήστος μιλάει με ένα κοριτσάκι αγγλικά!!! Έπαθα την πλάκα μου!!!',
        reviewDate: new Date('2024-03-28'),
        sortOrder: 2,
      },
      {
        author: 'Βερόνικα Ρ.',
        rating: 5,
        text: 'Όταν το πάθος για την διδασκαλία των αγγλικών συναντά την αληθινή αγάπη για τα παιδιά το αποτέλεσμα είναι μοναδικό. Είμαστε ευγνώμονες για την πολύτιμη μάθηση και από καρδιάς ευχαριστούμε για όλα ❤️',
        reviewDate: new Date('2023-06-05'),
        sortOrder: 3,
      },
    ];
    await prisma.review.createMany({ data: reviews });
    console.log(`Seeded ${reviews.length} in-house reviews`);
  } else {
    console.log('Reviews already exist, skipping');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
