// Порядок классов сегментации соответствует training/config.py (14 классов).
export const WRINKLE_CLASSES = [
  "Носогубные складки",
  "Носослезная борозда",
  "Гусиные лапки",
  "Лобные морщины",
  "Межбровные морщины",
  "Кольца Венеры",
  "Веко-скуловая борозда",
  "Поперечная морщина подбородка",
  "Складка марионетки",
  "Морщины уголков губ",
  "Щечно-скуловая борозда",
  "Щечные складки",
  "Малярный мешок",
  "Брыли",
];

const COUNT = WRINKLE_CLASSES.length;

// Стабильный цвет по индексу класса (равномерно по кругу оттенков).
export function colorForClass(label: string): string {
  let idx = WRINKLE_CLASSES.indexOf(label);
  if (idx < 0) {
    // неизвестный класс — детерминированный хэш
    let h = 0;
    for (let i = 0; i < label.length; i += 1) h = (h * 31 + label.charCodeAt(i)) % 360;
    return `hsl(${h}, 80%, 50%)`;
  }
  return `hsl(${Math.round((idx / COUNT) * 360)}, 80%, 50%)`;
}
