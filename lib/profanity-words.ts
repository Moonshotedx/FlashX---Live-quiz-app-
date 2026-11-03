/**
 * Small editable word list for the join name filter (lowercase, Latin script).
 * Entries starting with "=" match whole words only (avoids false positives such as "blunder" or "peacock").
 * Words of 3 letters or fewer are always whole word. Add or remove entries freely.
 * Includes English plus common transliterated Hindi and Kannada slurs.
 */
export const PROFANITY_WORDS: string[] = [
  // English
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'pussy',
  '=dick', '=cock', '=ass', '=porn', '=retard',
  // Hindi (transliterated)
  'madarchod', 'behenchod', 'bhenchod', 'bhosdike', 'bhosdi', 'chutiya', 'chutiye', 'gandu', 'harami', 'lauda', 'bhadwa',
  '=randi', '=lund', '=mc', '=bc',
  // Kannada (transliterated)
  'sulemaga', 'bolimaga', 'gandmasti',
  '=sule', '=boli', '=thika', '=tunne',
];
