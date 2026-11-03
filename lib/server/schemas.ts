import { z } from 'zod';
import { FONTS } from '../theme';

const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour like #7C3AED');
const urlOrEmpty = z.union([z.literal(''), z.string().url().max(1000)]);

export const themeSchema = z
  .object({
    preset: z.string().max(60),
    eventTitle: z.string().max(120),
    logoUrl: urlOrEmpty,
    primaryColor: hex,
    accentColor: hex,
    backgroundType: z.enum(['solid', 'gradient', 'image']),
    backgroundValue: z.string().max(2000),
    gradientFrom: hex,
    gradientTo: hex,
    overlay: z.number().min(0).max(100),
    textColor: hex,
    fontFamily: z.enum(FONTS as [string, ...string[]]),
    correctColor: hex,
    wrongColor: hex,
  })
  .partial();

export const quizSettingsSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().max(1000).nullable(),
    duration_seconds: z.number().int().min(30).max(3600),
    shuffle_questions: z.boolean(),
    shuffle_options: z.boolean(),
    allow_late_join: z.boolean(),
    show_live_leaderboard: z.boolean(),
    show_answers_after_reveal: z.boolean(),
    roll_number_mode: z.enum(['off', 'optional', 'required']),
    roll_number_label: z.string().trim().min(1).max(60),
    theme: themeSchema,
  })
  .partial();

export const questionsSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().uuid(),
        text: z.string().max(1000),
        image_url: z.string().url().max(1000).nullable(),
        points: z.number().int().min(0).max(100),
        options: z
          .array(z.object({ id: z.string().uuid(), text: z.string().max(300), is_correct: z.boolean() }))
          .max(6)
          .refine((o) => o.filter((x) => x.is_correct).length <= 1, 'Only one option can be correct'),
      }),
    )
    .max(100),
});

