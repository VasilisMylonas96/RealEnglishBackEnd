/* eslint-disable no-console */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const LEVELS = ['A-Junior', 'B-Junior', 'A-Senior', 'B-Senior', 'C-Junior', 'C-Senior'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const POINTS = { easy: 1, medium: 2, hard: 3 };

// ─── Question Bank ───────────────────────────────────────────────────────────
// Each entry: [level, difficulty, topic, questionText, options[], correctIndex, explanation]

const QUESTIONS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // A-JUNIOR (Beginner)
  // ═══════════════════════════════════════════════════════════════════════════

  // A-Junior EASY
  ['A-Junior', 'easy', 'Present Simple', 'She ___ to school every day.', ['goes', 'go', 'going', 'gone'], 0, 'Third person singular adds -es to "go" → "goes"'],
  ['A-Junior', 'easy', 'Present Simple', 'I ___ a student.', ['am', 'is', 'are', 'be'], 0, 'I always takes "am"'],
  ['A-Junior', 'easy', 'Articles', 'I have ___ apple.', ['a', 'an', 'the', 'no article'], 1, '"Apple" starts with a vowel sound, so we use "an"'],
  ['A-Junior', 'easy', 'Vocabulary', 'What color is the sky on a clear day?', ['Red', 'Blue', 'Green', 'Yellow'], 1, 'The sky is blue on a clear day'],
  ['A-Junior', 'easy', 'Present Simple', 'They ___ football on Sundays.', ['play', 'plays', 'playing', 'played'], 0, '"They" takes the base form "play"'],
  ['A-Junior', 'easy', 'Vocabulary', 'A ___ has four legs and barks.', ['cat', 'dog', 'bird', 'fish'], 1, 'A dog has four legs and barks'],
  ['A-Junior', 'easy', 'Present Simple', 'He ___ like pizza.', ['don\'t', 'doesn\'t', 'not', 'isn\'t'], 1, 'Third person singular negative uses "doesn\'t"'],
  ['A-Junior', 'easy', 'Articles', '___ sun is very hot today.', ['A', 'An', 'The', 'No article'], 2, 'We use "the" for unique things like the sun'],
  ['A-Junior', 'easy', 'Vocabulary', 'What do you call the person who teaches you at school?', ['doctor', 'teacher', 'driver', 'cook'], 1, 'A teacher teaches students at school'],
  ['A-Junior', 'easy', 'Present Simple', 'We ___ in a big house.', ['live', 'lives', 'living', 'lived'], 0, '"We" takes the base form "live"'],

  // A-Junior MEDIUM
  ['A-Junior', 'medium', 'Present Continuous', 'Look! It ___ outside.', ['rains', 'is raining', 'rain', 'rained'], 1, 'Present Continuous: "is raining" for actions happening now'],
  ['A-Junior', 'medium', 'Present Continuous', 'She ___ TV right now.', ['watches', 'is watching', 'watch', 'watched'], 1, 'Present Continuous: "is watching" for actions happening now'],
  ['A-Junior', 'medium', 'Prepositions', 'The cat is ___ the table.', ['on', 'in', 'at', 'by'], 0, '"On" is used for surfaces — the cat is on top of the table'],
  ['A-Junior', 'medium', 'Present Simple', '___ you like ice cream?', ['Do', 'Does', 'Are', 'Is'], 0, 'Questions with "you" use "Do"'],
  ['A-Junior', 'medium', 'Vocabulary', 'What do you call 30 days?', ['a week', 'a month', 'a year', 'a day'], 1, 'A month has approximately 30 days'],
  ['A-Junior', 'medium', 'Present Simple', 'My brother ___ in London.', ['live', 'lives', 'living', 'lived'], 1, 'Third person singular: "lives"'],
  ['A-Junior', 'medium', 'Articles', 'She is ___ engineer.', ['a', 'an', 'the', 'no article'], 1, '"Engineer" starts with a vowel sound, so we use "an"'],
  ['A-Junior', 'medium', 'Present Continuous', 'They ___ in the garden now.', ['work', 'are working', 'works', 'worked'], 1, 'Present Continuous: "are working" for actions happening now'],
  ['A-Junior', 'medium', 'Vocabulary', 'What is the opposite of "hot"?', ['warm', 'cold', 'cool', 'sunny'], 1, 'The opposite of "hot" is "cold"'],
  ['A-Junior', 'medium', 'Present Simple', '___ she speak English?', ['Do', 'Does', 'Is', 'Are'], 1, 'Third person singular questions use "Does"'],

  // A-Junior HARD
  ['A-Junior', 'hard', 'Present Simple vs Continuous', 'I usually ___ coffee, but today I ___ tea.', ['drink / am drinking', 'am drinking / drink', 'drink / drink', 'am drinking / am drinking'], 0, 'Habits use Present Simple; today\'s exception uses Present Continuous'],
  ['A-Junior', 'hard', 'Prepositions', 'The meeting is ___ Monday ___ 10 o\'clock.', ['at / on', 'on / at', 'in / on', 'on / in'], 1, 'We use "on" for days and "at" for specific times'],
  ['A-Junior', 'hard', 'Vocabulary', 'Which word is NOT a type of weather?', ['sunny', 'rainy', 'cloudy', 'happy'], 3, '"Happy" is an emotion, not a weather type'],
  ['A-Junior', 'hard', 'Present Simple', 'Neither of the boys ___ here.', ['is', 'are', 'were', 'be'], 0, '"Neither" is singular, so we use "is"'],
  ['A-Junior', 'hard', 'Articles', 'I saw ___ elephant at ___ zoo yesterday.', ['an / the', 'a / the', 'an / a', 'a / a'], 0, '"An" before vowel sound; "the" for specific place (the zoo)'],

  // ═══════════════════════════════════════════════════════════════════════════
  // B-JUNIOR (Elementary)
  // ═══════════════════════════════════════════════════════════════════════════

  // B-Junior EASY
  ['B-Junior', 'easy', 'Past Simple', 'Yesterday I ___ to the park.', ['go', 'went', 'gone', 'going'], 1, 'Past simple of "go" is "went"'],
  ['B-Junior', 'easy', 'Past Simple', 'She ___ a letter last night.', ['write', 'wrote', 'written', 'writing'], 1, 'Past simple of "write" is "wrote"'],
  ['B-Junior', 'easy', 'Vocabulary', 'A ___ is a place where you can buy books.', ['bakery', 'bookshop', 'pharmacy', 'garage'], 1, 'A bookshop sells books'],
  ['B-Junior', 'easy', 'Past Simple', 'We ___ a great film last weekend.', ['see', 'saw', 'seen', 'seeing'], 1, 'Past simple of "see" is "saw"'],
  ['B-Junior', 'easy', 'Comparatives', 'This book is ___ than that one.', ['interesting', 'more interesting', 'most interesting', 'interestinger'], 1, 'Longer adjectives use "more" for comparison'],
  ['B-Junior', 'easy', 'Past Simple', 'He ___ his keys this morning.', ['lose', 'lost', 'losted', 'losing'], 1, 'Past simple of "lose" is "lost"'],
  ['B-Junior', 'easy', 'Vocabulary', 'What do you call a person who flies a plane?', ['sailor', 'pilot', 'driver', 'conductor'], 1, 'A pilot flies a plane'],
  ['B-Junior', 'easy', 'Past Simple', '___ you enjoy the party?', ['Did', 'Do', 'Were', 'Was'], 0, 'Past simple questions use "Did"'],
  ['B-Junior', 'easy', 'Comparatives', 'My sister is ___ than me.', ['tall', 'taller', 'tallest', 'more tall'], 1, 'Short adjectives add -er for comparison'],
  ['B-Junior', 'easy', 'Past Simple', 'They ___ to music all evening.', ['listen', 'listened', 'listening', 'listens'], 1, 'Past simple of "listen" is "listened"'],

  // B-Junior MEDIUM
  ['B-Junior', 'medium', 'Past Continuous', 'At 8 PM yesterday, I ___ dinner.', ['cook', 'cooked', 'was cooking', 'cooking'], 2, 'Past Continuous for an action in progress at a specific past time'],
  ['B-Junior', 'medium', 'Past Simple', 'She ___ to Paris three times.', ['been', 'gone', 'was', 'went'], 0, '"Been" (past participle) is used with "has/have" for experiences'],
  ['B-Junior', 'medium', 'Vocabulary', 'A ___ is a large body of salt water.', ['lake', 'river', 'ocean', 'stream'], 2, 'An ocean is a large body of salt water'],
  ['B-Junior', 'medium', 'Comparatives', 'This is the ___ film I have ever seen.', ['good', 'better', 'best', 'most good'], 2, 'Superlative of "good" is "best"'],
  ['B-Junior', 'medium', 'Past Simple', 'The train ___ at 9:30.', ['leave', 'left', 'leaved', 'leaves'], 1, 'Past simple of "leave" is "left"'],
  ['B-Junior', 'medium', 'Vocabulary', 'What is a "pedestrian"?', ['a driver', 'a person walking', 'a cyclist', 'a passenger'], 1, 'A pedestrian is a person walking on the street'],
  ['B-Junior', 'medium', 'Past Continuous', 'While I ___ TV, the phone rang.', ['watch', 'watched', 'was watching', 'watching'], 2, 'Past Continuous for the longer action interrupted by a shorter one'],
  ['B-Junior', 'medium', 'Comparatives', 'The weather today is ___ than yesterday.', ['bad', 'worse', 'worst', 'badder'], 1, 'Irregular comparative: bad → worse'],
  ['B-Junior', 'medium', 'Past Simple', 'I ___ my homework before dinner.', ['finish', 'finished', 'finishing', 'finishes'], 1, 'Past simple of "finish" is "finished"'],
  ['B-Junior', 'medium', 'Vocabulary', 'A "recipe" is instructions for ___.', ['driving', 'cooking', 'swimming', 'reading'], 1, 'A recipe gives instructions for cooking a dish'],

  // B-Junior HARD
  ['B-Junior', 'hard', 'Past Simple vs Continuous', 'I ___ (walk) home when it started to rain.', ['walked', 'was walking', 'walk', 'am walking'], 1, 'Past Continuous for the background action interrupted by Past Simple'],
  ['B-Junior', 'hard', 'Vocabulary', 'Which word means "very tired"?', ['exhausted', 'excited', 'embarrassed', 'exaggerated'], 0, '"Exhausted" means extremely tired'],
  ['B-Junior', 'hard', 'Comparatives', 'The more you practice, the ___ you get.', ['good', 'better', 'best', 'well'], 1, '"The more... the better" is a double comparative structure'],
  ['B-Junior', 'hard', 'Past Simple', 'By the time we arrived, the film ___.', ['already started', 'had already started', 'has already started', 'was already starting'], 1, 'Past Perfect for an action completed before another past action'],
  ['B-Junior', 'hard', 'Vocabulary', 'A "commute" is the journey from ___ to work.', ['home', 'school', 'the airport', 'the hospital'], 0, 'A commute is the regular journey from home to work'],

  // ═══════════════════════════════════════════════════════════════════════════
  // A-SENIOR (Pre-Intermediate)
  // ═══════════════════════════════════════════════════════════════════════════

  // A-Senior EASY
  ['A-Senior', 'easy', 'Present Perfect', 'I ___ never ___ to Japan.', ['have / been', 'has / been', 'have / gone', 'did / go'], 0, 'Present Perfect: "have been" for life experiences'],
  ['A-Senior', 'easy', 'Present Perfect', 'She ___ just finished her homework.', ['has', 'have', 'had', 'is'], 0, 'Third person singular uses "has"'],
  ['A-Senior', 'easy', 'Vocabulary', 'A "deadline" is the time by which something must be ___.', ['started', 'completed', 'planned', 'discussed'], 1, 'A deadline is the final time to complete something'],
  ['A-Senior', 'easy', 'Present Perfect', '___ you ever ___ sushi?', ['Have / tried', 'Did / try', 'Do / try', 'Has / tried'], 0, 'Present Perfect for life experiences: "Have you ever tried?"'],
  ['A-Senior', 'easy', 'Modals', 'You ___ wear a uniform at this school.', ['must', 'mustn\'t', 'can\'t', 'shouldn\'t'], 0, '"Must" expresses obligation'],
  ['A-Senior', 'easy', 'Present Perfect', 'We ___ each other for ten years.', ['know', 'have known', 'knew', 'are knowing'], 1, 'Present Perfect for a state that started in the past and continues'],
  ['A-Senior', 'easy', 'Vocabulary', 'To "improve" means to make something ___.', ['worse', 'better', 'bigger', 'faster'], 1, '"Improve" means to make something better'],
  ['A-Senior', 'easy', 'Present Perfect', 'He ___ his keys again!', ['lost', 'has lost', 'loses', 'is losing'], 1, 'Present Perfect for a recent action with present relevance'],
  ['A-Senior', 'easy', 'Modals', 'You ___ smoke in the hospital.', ['can', 'may', 'mustn\'t', 'should'], 2, '"Mustn\'t" expresses prohibition'],
  ['A-Senior', 'easy', 'Present Perfect', 'I ___ my bag. Can you help me find it?', ['lost', 'have lost', 'am losing', 'lose'], 1, 'Present Perfect for a past action with present result'],

  // A-Senior MEDIUM
  ['A-Senior', 'medium', 'Present Perfect vs Past Simple', 'I ___ that film last week.', ['have seen', 'saw', 'had seen', 'see'], 1, 'Past Simple for a specific time in the past ("last week")'],
  ['A-Senior', 'medium', 'Present Perfect', 'She ___ in London since 2020.', ['lives', 'has lived', 'lived', 'is living'], 1, 'Present Perfect with "since" for a period from past to now'],
  ['A-Senior', 'medium', 'Vocabulary', 'A "volunteer" is someone who works ___.', ['for money', 'without pay', 'part-time', 'full-time'], 1, 'A volunteer works without receiving payment'],
  ['A-Senior', 'medium', 'Modals', 'You ___ be tired. You haven\'t slept in 48 hours!', ['must', 'can\'t', 'shouldn\'t', 'might'], 0, '"Must" for a strong logical deduction'],
  ['A-Senior', 'medium', 'Present Perfect', 'How long ___ you ___ English?', ['have / studied', 'did / study', 'do / study', 'had / studied'], 0, 'Present Perfect for duration from past to now'],
  ['A-Senior', 'medium', 'Vocabulary', 'A "scholarship" is money given to a student for ___.', ['housing', 'education', 'travel', 'food'], 1, 'A scholarship funds a student\'s education'],
  ['A-Senior', 'medium', 'Present Perfect', 'I ___ all my homework. I can go out now!', ['finished', 'have finished', 'finish', 'am finishing'], 1, 'Present Perfect for a completed action with present result'],
  ['A-Senior', 'medium', 'Modals', '___ I borrow your pen?', ['Must', 'May', 'Should', 'Would'], 1, '"May I..." is a polite way to ask for permission'],
  ['A-Senior', 'medium', 'Present Perfect', 'She ___ three cups of coffee already.', ['drinks', 'has drunk', 'drank', 'is drinking'], 1, 'Present Perfect with "already" for a completed action'],
  ['A-Senior', 'medium', 'Vocabulary', 'To "postpone" means to ___.', ['cancel', 'delay', 'confirm', 'complete'], 1, '"Postpone" means to delay to a later time'],

  // A-Senior HARD
  ['A-Senior', 'hard', 'Present Perfect', 'I\'ve ___ my phone. I can\'t find it anywhere.', ['lost', 'losen', 'lose', 'losing'], 0, 'Past participle of "lose" is "lost" (not "losen")'],
  ['A-Senior', 'hard', 'Modals', 'He ___ be at home. His car is in the driveway.', ['can\'t', 'must', 'shouldn\'t', 'might not'], 1, '"Must" for a strong positive deduction'],
  ['A-Senior', 'hard', 'Present Perfect', 'By next year, I ___ here for five years.', ['will have worked', 'have worked', 'will work', 'had worked'], 0, 'Future Perfect for a duration up to a future point'],
  ['A-Senior', 'hard', 'Vocabulary', 'A "bureaucracy" refers to ___.', ['a type of art', 'excessive government rules and procedures', 'a musical instrument', 'a cooking method'], 1, 'Bureaucracy means excessive official rules and procedures'],
  ['A-Senior', 'hard', 'Present Perfect', '___ you ___ to the meeting? I need to know if you\'ve seen the report.', ['Have / been', 'Did / go', 'Do / go', 'Had / been'], 0, 'Present Perfect for a recent action with present relevance'],

  // ═══════════════════════════════════════════════════════════════════════════
  // B-SENIOR (Intermediate)
  // ═══════════════════════════════════════════════════════════════════════════

  // B-Senior EASY
  ['B-Senior', 'easy', 'Conditionals', 'If I ___ rich, I would travel the world.', ['am', 'was', 'were', 'be'], 2, 'Second conditional: "If I were" (subjunctive)'],
  ['B-Senior', 'easy', 'Conditionals', 'If it rains, we ___ at home.', ['stay', 'will stay', 'would stay', 'stayed'], 1, 'First conditional: "If + present, will + base"'],
  ['B-Senior', 'easy', 'Passive Voice', 'The letter ___ by the postman this morning.', ['was delivered', 'delivered', 'is delivered', 'has delivered'], 0, 'Passive voice: "was delivered" (past simple passive)'],
  ['B-Senior', 'easy', 'Vocabulary', 'A "negotiation" is a discussion to reach an ___.', ['argument', 'agreement', 'accident', 'adventure'], 1, 'A negotiation aims to reach an agreement'],
  ['B-Senior', 'easy', 'Conditionals', 'If she ___ harder, she would pass the exam.', ['studied', 'studies', 'study', 'has studied'], 0, 'Second conditional: "If + past simple, would + base"'],
  ['B-Senior', 'easy', 'Passive Voice', 'English ___ in many countries around the world.', ['speaks', 'is spoken', 'spoke', 'has spoken'], 1, 'Passive voice: "is spoken" (present simple passive)'],
  ['B-Senior', 'easy', 'Vocabulary', 'To "compromise" means to ___.', ['win completely', 'make mutual concessions', 'refuse to talk', 'start a fight'], 1, 'A compromise involves both sides giving up something'],
  ['B-Senior', 'easy', 'Conditionals', 'If I ___ known, I would have helped.', ['had', 'have', 'has', 'would'], 0, 'Third conditional: "If + past perfect, would have + past participle"'],
  ['B-Senior', 'easy', 'Passive Voice', 'The bridge ___ in 1990.', ['built', 'was built', 'is built', 'has been built'], 1, 'Past simple passive: "was built"'],
  ['B-Senior', 'easy', 'Vocabulary', 'A "stakeholder" is someone who has an ___ in a project.', ['interest', 'enemy', 'office', 'address'], 0, 'A stakeholder has an interest in the outcome of a project'],

  // B-Senior MEDIUM
  ['B-Senior', 'medium', 'Conditionals', 'If I ___ you, I would accept the offer.', ['am', 'was', 'were', 'be'], 2, '"If I were you" is the standard second conditional for advice'],
  ['B-Senior', 'medium', 'Passive Voice', 'The results ___ next week.', ['will announce', 'will be announced', 'are announcing', 'have announced'], 1, 'Future passive: "will be announced"'],
  ['B-Senior', 'medium', 'Vocabulary', 'A "breakthrough" is a sudden ___ in understanding or progress.', ['setback', 'advance', 'failure', 'delay'], 1, 'A breakthrough is a sudden positive advance'],
  ['B-Senior', 'medium', 'Conditionals', 'If he had studied, he ___ the exam.', ['would pass', 'would have passed', 'will pass', 'passes'], 1, 'Third conditional: "would have + past participle"'],
  ['B-Senior', 'medium', 'Passive Voice', 'My car ___ yesterday.', ['stole', 'was stolen', 'is stolen', 'has stolen'], 1, 'Past simple passive: "was stolen"'],
  ['B-Senior', 'medium', 'Vocabulary', 'To "undermine" means to ___.', ['strengthen', 'weaken gradually', 'destroy instantly', 'improve'], 1, '"Undermine" means to weaken or damage gradually'],
  ['B-Senior', 'medium', 'Conditionals', 'Unless you hurry, you ___ the bus.', ['miss', 'will miss', 'would miss', 'missed'], 1, '"Unless" = "if not" → first conditional: "will miss"'],
  ['B-Senior', 'medium', 'Passive Voice', 'The new policy ___ by the government last month.', ['implemented', 'was implemented', 'is implemented', 'has implemented'], 1, 'Past simple passive: "was implemented"'],
  ['B-Senior', 'medium', 'Vocabulary', 'A "paradox" is a statement that seems ___ but may be true.', ['obvious', 'contradictory', 'boring', 'simple'], 1, 'A paradox seems contradictory but may contain truth'],
  ['B-Senior', 'medium', 'Conditionals', 'If I ___ the answer, I would tell you.', ['knew', 'know', 'have known', 'will know'], 0, 'Second conditional: "If + past simple, would + base"'],

  // B-Senior HARD
  ['B-Senior', 'hard', 'Conditionals', 'If I ___ the truth, I would have told you.', ['knew', 'had known', 'know', 'have known'], 1, 'Third conditional: "If + past perfect, would have + past participle"'],
  ['B-Senior', 'hard', 'Passive Voice', 'The suspect ___ by the police for hours.', ['interrogates', 'was interrogated', 'is interrogating', 'has interrogated'], 1, 'Past simple passive: "was interrogated"'],
  ['B-Senior', 'hard', 'Vocabulary', 'A "dilemma" is a situation where you must choose between ___.', ['two good options', 'two bad options', 'no options', 'many options'], 1, 'A dilemma is a difficult choice between two undesirable options'],
  ['B-Senior', 'hard', 'Conditionals', 'But for your help, I ___ the project.', ['would fail', 'would have failed', 'will fail', 'failed'], 1, '"But for" = "if it had not been for" → third conditional'],
  ['B-Senior', 'hard', 'Vocabulary', 'To "allege" means to ___ something without proof.', ['prove', 'claim', 'deny', 'confirm'], 1, '"Allege" means to claim something is true without evidence'],

  // ═══════════════════════════════════════════════════════════════════════════
  // C-JUNIOR (Upper-Intermediate)
  // ═══════════════════════════════════════════════════════════════════════════

  // C-Junior EASY
  ['C-Junior', 'easy', 'Inversion', 'Never ___ such a beautiful sunset.', ['I have seen', 'have I seen', 'I saw', 'did I see'], 1, 'Inversion after "Never": "Never have I seen..."'],
  ['C-Junior', 'easy', 'Cleft Sentences', 'It was John ___ broke the window.', ['who', 'which', 'that was', 'whom'], 0, 'Cleft sentence: "It was John who..."'],
  ['C-Junior', 'easy', 'Vocabulary', 'A "meticulous" person is ___.', ['careless', 'extremely careful and precise', 'lazy', 'rude'], 1, '"Meticulous" means showing great attention to detail'],
  ['C-Junior', 'easy', 'Inversion', 'Not only ___ late, but he also forgot the documents.', ['he was', 'was he', 'he is', 'is he'], 1, 'Inversion after "Not only": "Not only was he late..."'],
  ['C-Junior', 'easy', 'Vocabulary', 'To "scrutinize" means to ___.', ['ignore', 'examine very carefully', 'approve quickly', 'reject'], 1, '"Scrutinize" means to examine in great detail'],
  ['C-Junior', 'easy', 'Cleft Sentences', 'What I need is ___.', ['a break', 'break', 'the break', 'some breaks'], 0, 'Cleft sentence: "What I need is a break"'],
  ['C-Junior', 'easy', 'Inversion', 'Under no circumstances ___ leave the room.', ['you should', 'should you', 'you must', 'must you'], 1, 'Inversion after "Under no circumstances": "should you"'],
  ['C-Junior', 'easy', 'Vocabulary', 'A "pragmatic" approach is ___.', ['theoretical', 'practical and realistic', 'emotional', 'artistic'], 1, '"Pragmatic" means practical and realistic'],
  ['C-Junior', 'easy', 'Cleft Sentences', 'It was because of the rain ___ the match was cancelled.', ['that', 'which', 'who', 'where'], 0, 'Cleft sentence: "It was because of the rain that..."'],
  ['C-Junior', 'easy', 'Vocabulary', 'To "exacerbate" a problem means to ___.', ['solve it', 'make it worse', 'ignore it', 'prevent it'], 1, '"Exacerbate" means to make a problem worse'],

  // C-Junior MEDIUM
  ['C-Junior', 'medium', 'Inversion', 'Seldom ___ such dedication in a young person.', ['I have seen', 'have I seen', 'I saw', 'did I see'], 1, 'Inversion after "Seldom": "Seldom have I seen..."'],
  ['C-Junior', 'medium', 'Vocabulary', 'A "cynic" is someone who ___.', ['believes in everything', 'doubts the sincerity of others', 'is always happy', 'travels a lot'], 1, 'A cynic doubts the honesty or sincerity of others'],
  ['C-Junior', 'medium', 'Inversion', 'No sooner ___ the house than the phone rang.', ['I had left', 'had I left', 'I left', 'did I leave'], 1, 'Inversion after "No sooner": "No sooner had I left..."'],
  ['C-Junior', 'medium', 'Vocabulary', 'To "mitigate" a risk means to ___.', ['increase it', 'reduce its severity', 'ignore it', 'accept it fully'], 1, '"Mitigate" means to reduce the severity or impact'],
  ['C-Junior', 'medium', 'Cleft Sentences', 'What surprised me most was ___.', ['how kind she was', 'how kind she is', 'she was so kind', 'that she kind'], 0, 'Cleft sentence: "What surprised me most was how kind she was"'],
  ['C-Junior', 'medium', 'Vocabulary', 'A "bureaucrat" is a person who ___.', ['works in government and follows rules rigidly', 'is a business owner', 'teaches law', 'writes laws'], 0, 'A bureaucrat is a government official who follows rules rigidly'],
  ['C-Junior', 'medium', 'Inversion', 'Little ___ that his actions would have such consequences.', ['he knew', 'did he know', 'he knows', 'does he know'], 1, 'Inversion after "Little": "Little did he know..."'],
  ['C-Junior', 'medium', 'Vocabulary', 'To "perpetuate" means to ___.', ['end', 'continue indefinitely', 'start', 'change'], 1, '"Perpetuate" means to make something continue indefinitely'],
  ['C-Junior', 'medium', 'Cleft Sentences', 'It is the students ___ are responsible for the mess.', ['who', 'which', 'that was', 'whom'], 0, 'Cleft sentence: "It is the students who are responsible..."'],
  ['C-Junior', 'medium', 'Vocabulary', 'A "skeptic" is someone who ___.', ['accepts everything', 'questions claims and demands evidence', 'believes in luck', 'follows trends'], 1, 'A skeptic questions claims and demands evidence'],

  // C-Junior HARD
  ['C-Junior', 'hard', 'Inversion', 'Hardly ___ arrived when the power went out.', ['I had', 'had I', 'I have', 'have I'], 1, 'Inversion after "Hardly": "Hardly had I arrived..."'],
  ['C-Junior', 'hard', 'Vocabulary', 'A "quixotic" person is ___.', ['realistic', 'unrealistically idealistic', 'cruel', 'indifferent'], 1, '"Quixotic" means unrealistically idealistic (from Don Quixote)'],
  ['C-Junior', 'hard', 'Inversion', 'On no account ___ disclose the information.', ['you must', 'must you', 'you should', 'should you'], 1, 'Inversion after "On no account": "must you"'],
  ['C-Junior', 'hard', 'Vocabulary', 'To "obfuscate" means to ___.', ['clarify', 'make deliberately unclear', 'simplify', 'translate'], 1, '"Obfuscate" means to make something deliberately unclear'],
  ['C-Junior', 'hard', 'Cleft Sentences', 'What the report failed to mention was ___.', ['the cost', 'the costs were', 'that the cost', 'the cost was'], 0, 'Cleft sentence: "What the report failed to mention was the cost"'],

  // ═══════════════════════════════════════════════════════════════════════════
  // C-SENIOR (Advanced)
  // ═══════════════════════════════════════════════════════════════════════════

  // C-Senior EASY
  ['C-Senior', 'easy', 'Subjunctive', 'I suggest that he ___ more carefully.', ['studies', 'study', 'studied', 'has studied'], 1, 'Subjunctive after "suggest": base form "study"'],
  ['C-Senior', 'easy', 'Vocabulary', 'A "fastidious" person is ___.', ['sloppy', 'very particular and demanding', 'generous', 'quiet'], 1, '"Fastidious" means very particular and demanding about details'],
  ['C-Senior', 'easy', 'Subjunctive', 'It is essential that she ___ here on time.', ['comes', 'come', 'came', 'has come'], 1, 'Subjunctive after "essential that": base form "come"'],
  ['C-Senior', 'easy', 'Vocabulary', 'To "laconic" means to use ___.', ['many words', 'very few words', 'only metaphors', 'technical jargon'], 1, '"Laconic" means using very few words (terse)'],
  ['C-Senior', 'easy', 'Subjunctive', 'I demand that the report ___ immediately.', ['is submitted', 'be submitted', 'was submitted', 'has been submitted'], 1, 'Subjunctive after "demand that": "be submitted"'],
  ['C-Senior', 'easy', 'Vocabulary', 'A "sycophant" is someone who ___.', ['is honest', 'flatters people to gain advantage', 'is silent', 'is rebellious'], 1, 'A sycophant flatters people to gain their favor'],
  ['C-Senior', 'easy', 'Subjunctive', 'It is crucial that every student ___ the rules.', ['knows', 'know', 'knew', 'has known'], 1, 'Subjunctive after "crucial that": base form "know"'],
  ['C-Senior', 'easy', 'Vocabulary', 'To "ephemeral" means ___.', ['lasting forever', 'lasting a very short time', 'extremely large', 'very bright'], 1, '"Ephemeral" means lasting a very short time'],
  ['C-Senior', 'easy', 'Subjunctive', 'I insist that he ___ present at the meeting.', ['is', 'be', 'was', 'has been'], 1, 'Subjunctive after "insist that": base form "be"'],
  ['C-Senior', 'easy', 'Vocabulary', 'A "magnanimous" person is ___.', ['stingy', 'generous, especially to a rival', 'angry', 'shy'], 1, '"Magnanimous" means generous, especially to a rival or inferior'],

  // C-Senior MEDIUM
  ['C-Senior', 'medium', 'Subjunctive', 'The committee recommended that the proposal ___ rejected.', ['is', 'be', 'was', 'has been'], 1, 'Subjunctive after "recommended that": base form "be"'],
  ['C-Senior', 'medium', 'Vocabulary', 'A "pragmatist" is someone who ___.', ['follows theory', 'prioritizes practical results over ideals', 'is always optimistic', 'avoids decisions'], 1, 'A pragmatist prioritizes practical results over abstract ideals'],
  ['C-Senior', 'medium', 'Subjunctive', 'It is imperative that the data ___ before the deadline.', ['is verified', 'be verified', 'was verified', 'has been verified'], 1, 'Subjunctive after "imperative that": base form "be verified"'],
  ['C-Senior', 'medium', 'Vocabulary', 'To "obsequious" means to be ___.', ['proud', 'excessively obedient or flattering', 'indifferent', 'aggressive'], 1, '"Obsequious" means excessively obedient or flattering'],
  ['C-Senior', 'medium', 'Subjunctive', 'I propose that the meeting ___ postponed.', ['is', 'be', 'was', 'has been'], 1, 'Subjunctive after "propose that": base form "be"'],
  ['C-Senior', 'medium', 'Vocabulary', 'A "misogynist" is someone who ___.', ['loves women', 'has prejudice against women', 'is a feminist', 'is a philosopher'], 1, 'A misogynist has prejudice or hatred against women'],
  ['C-Senior', 'medium', 'Subjunctive', 'It is vital that the witness ___ available for the trial.', ['is', 'be', 'was', 'has been'], 1, 'Subjunctive after "vital that": base form "be"'],
  ['C-Senior', 'medium', 'Vocabulary', 'To "surreptitious" means ___.', ['open and obvious', 'done secretly or hidden', 'very loud', 'extremely fast'], 1, '"Surreptitious" means done secretly or in a hidden way'],
  ['C-Senior', 'medium', 'Subjunctive', 'The board requires that all employees ___ the new policy.', ['read', 'reads', 'readed', 'have read'], 0, 'Subjunctive after "requires that": base form "read"'],
  ['C-Senior', 'medium', 'Vocabulary', 'A "philistine" is someone who ___.', ['loves art', 'is indifferent to culture and art', 'is a scientist', 'is a politician'], 1, 'A philistine is someone indifferent to culture and art'],

  // C-Senior HARD
  ['C-Senior', 'hard', 'Subjunctive', 'It is essential that the CEO ___ informed of the crisis immediately.', ['is', 'be', 'was', 'has been'], 1, 'Subjunctive after "essential that": base form "be"'],
  ['C-Senior', 'hard', 'Vocabulary', 'A "pundit" is someone who ___.', ['is an expert on a subject', 'is a beginner', 'is a critic of experts', 'is a journalist'], 0, 'A pundit is a recognized expert or authority on a subject'],
  ['C-Senior', 'hard', 'Subjunctive', 'I move that the motion ___ carried.', ['is', 'be', 'was', 'has been'], 1, 'Formal subjunctive: "I move that the motion be carried"'],
  ['C-Senior', 'hard', 'Vocabulary', 'To "obdurate" means to be ___.', ['flexible', 'stubbornly refusing to change one\'s mind', 'kind', 'easily persuaded'], 1, '"Obdurate" means stubbornly refusing to change one\'s mind'],
  ['C-Senior', 'hard', 'Subjunctive', 'It is of the utmost importance that the evidence ___ preserved.', ['is', 'be', 'was', 'has been'], 1, 'Subjunctive after "of the utmost importance that": base form "be"'],
];

// ─── Seed ────────────────────────────────────────────────────────────────────

async function main() {
  const count = await prisma.question.count();
  if (count > 0) {
    console.log(`Question bank already has ${count} questions. Skipping seed.`);
    return;
  }

  console.log(`Seeding ${QUESTIONS.length} questions...`);

  const data = QUESTIONS.map(([level, difficulty, topic, questionText, options, correctAnswer, explanation]) => ({
    level,
    difficulty,
    topicSyllabusTag: topic,
    questionText,
    options: JSON.stringify(options),
    correctAnswer,
    explanation,
    points: POINTS[difficulty],
  }));

  await prisma.question.createMany({ data });
  console.log(`Seeded ${QUESTIONS.length} questions.`);

  // Summary by level/difficulty
  for (const level of LEVELS) {
    for (const diff of DIFFICULTIES) {
      const c = QUESTIONS.filter((q) => q[0] === level && q[1] === diff).length;
      if (c > 0) console.log(`  ${level} / ${diff}: ${c}`);
    }
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
