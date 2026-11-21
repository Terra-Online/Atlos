import { z } from 'zod';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const routeQuerySchema = z.strictObject({
  starts: z.array(
    z.strictObject({
      id: z.string().min(1),
      position: vec3,
      cost: z.number(),
      state: z.enum(['available', 'locked', 'unknown']),
    }),
  ),
  goal: vec3,
  interaction: z
    .strictObject({
      radius: z.number(),
      maxVertical: z.number().optional(),
      facing: vec3.optional(),
      halfAngle: z.number().optional(),
      airborne: z.boolean().optional(),
    })
    .optional(),
  waypoints: z.array(vec3).optional(),
});
