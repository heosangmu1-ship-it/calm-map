// YAMNet (AudioSet) class index -> sensory group (CONTRACT v2). Indices follow yamnet_class_map.csv (0..520).
// Unlisted classes are "other". Rows are [first, last, group, note]; a later row overrides an earlier one.
export const GROUPS = ['alarm', 'loudhuman', 'mechanical', 'sustained', 'speech', 'calm', 'other'];

const TABLE = [
  // sustained: continuous background that tires but is predictable
  [13, 18, 'sustained', 'Laughter variants (a laughing crowd)'],
  [24, 32, 'sustained', 'Singing, choir, chant, rapping, humming (music family)'],
  [58, 58, 'sustained', 'Clapping'],
  [61, 66, 'sustained', 'Cheering, applause, chatter, crowd, hubbub, children playing'],
  [132, 194, 'sustained', 'Music, instruments (strings, keys, percussion, brass, orchestra)'],
  [203, 276, 'sustained', 'Harmonica...singing bowl, scratching, genres and moods of music (bells 195-202 stay other)'],
  [294, 335, 'sustained', 'Vehicles, boats, car, bus, truck, motorcycle, traffic noise, rail, aircraft, bicycle (alarm-type sounds are overridden below)'],
  [337, 347, 'sustained', 'Engine, idling, revving'],
  [518, 519, 'sustained', 'Television, radio'],
  // speech
  [0, 5, 'speech', 'Speech, child speech, conversation, narration, babbling, speech synthesizer'],
  [12, 12, 'speech', 'Whispering'],
  // loudhuman
  [6, 11, 'loudhuman', 'Shout, bellow, whoop, yell, children shouting, screaming'],
  [19, 20, 'loudhuman', 'Crying/sobbing, baby cry'],
  // mechanical
  [339, 341, 'mechanical', 'Dental drill, lawn mower, chainsaw (borderline vs engine: tool-like, so mechanical)'],
  [362, 363, 'mechanical', 'Microwave oven, blender'],
  [367, 367, 'mechanical', 'Hair dryer'],
  [370, 371, 'mechanical', 'Electric toothbrush, vacuum cleaner'],
  [376, 376, 'mechanical', 'Electric shaver'],
  [405, 407, 'mechanical', 'Sewing machine, mechanical fan, air conditioning'],
  [409, 409, 'mechanical', 'Printer'],
  [412, 419, 'mechanical', 'Tools, hammer, jackhammer, sawing, filing, sanding, power tool, drill'],
  [482, 482, 'mechanical', 'Whir'],
  // alarm: sounds made to demand attention
  [302, 303, 'alarm', 'Vehicle horn, toot'],
  [304, 304, 'alarm', 'Car alarm'],
  [312, 313, 'alarm', 'Air horn, reversing beeps'],
  [316, 319, 'alarm', 'Emergency vehicle, police, ambulance, fire engine sirens (siren: alarm, not traffic)'],
  [324, 325, 'alarm', 'Train whistle, train horn (borderline: sudden and piercing, so alarm)'],
  [382, 382, 'alarm', 'Alarm'],
  [389, 389, 'alarm', 'Alarm clock'],
  [390, 394, 'alarm', 'Siren, civil defense siren, buzzer, smoke alarm, fire alarm'],
  [395, 397, 'alarm', 'Foghorn, whistle, steam whistle'],
  [475, 475, 'alarm', 'Beep, bleep'],
  // alarm-like impulses: explosions and bangs are sudden and piercing; put with alarm for priority load
  [420, 430, 'alarm', 'Explosion, gunshot, fireworks, firecracker, burst, boom (borderline: no better group; shock load)'],
  [460, 460, 'alarm', 'Bang'],
  // calm
  [106, 116, 'calm', 'Birds'],
  [121, 122, 'calm', 'Insect, cricket'],
  [127, 128, 'calm', 'Frog, croak'],
  [277, 278, 'calm', 'Wind, rustling leaves (279 wind noise on the mic is a recording artefact: other)'],
  [282, 289, 'calm', 'Water, rain, stream, waterfall, ocean, waves'],
  [292, 293, 'calm', 'Fire, crackle'],
  [442, 444, 'calm', 'Drip, pour, trickle'],
  [481, 481, 'calm', 'Rustle'],
  [494, 494, 'calm', 'Silence'],
  [504, 504, 'calm', 'Outside, rural or natural'],
];

// Chime / ding-dong are not a group: they only set the `chime` flag (store announcement jingles, doorbell).
export const CHIME_CLASSES = [200, 349, 350]; // Chime, Doorbell, Ding-dong

const MAP = new Array(521).fill('other');
for (const [a, b, g] of TABLE) for (let i = a; i <= b; i++) MAP[i] = g;

/** @param {number} index YAMNet class index 0..520 @returns {string} group name */
export function groupOf(index) {
  return MAP[index] || 'other';
}

/** Sum scores per group. @param {ArrayLike<number>} scores 521 values @returns {Record<string, number>} */
export function groupScores(scores) {
  const sums = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (let i = 0; i < scores.length; i++) sums[MAP[i] || 'other'] += scores[i];
  return sums;
}

/** Strongest chime-class score in a score vector. */
export function chimeScore(scores) {
  return Math.max(...CHIME_CLASSES.map((i) => scores[i]));
}

export const TABLE_ROWS = TABLE;
