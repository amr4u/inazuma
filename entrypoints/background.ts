import { bootBackground } from '../src/app/background';
export default defineBackground({ persistent: true, main() { bootBackground(); } });
