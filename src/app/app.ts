import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AiService } from './ai/ai.service';
import { ActionBar } from './components/action-bar/action-bar';
import { ChatPanel } from './components/chat-panel/chat-panel';
import { GameLog } from './components/game-log/game-log';
import { HandResult } from './components/hand-result/hand-result';
import { PokerTable } from './components/poker-table/poker-table';
import { StartScreen } from './components/start-screen/start-screen';
import { GameService } from './game/game.service';

@Component({
  selector: 'app-root',
  imports: [ActionBar, ChatPanel, GameLog, HandResult, PokerTable, StartScreen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly game = inject(GameService);
  protected readonly ai = inject(AiService);
}
