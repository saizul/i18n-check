import { Component } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Component({ selector: 'app-root', templateUrl: './app.component.html' })
export class AppComponent {
  user = 'Saizul';
  labelKey = 'MENU.SAVE';
  constructor(private translate: TranslateService) {}

  save(): void {
    alert(this.translate.instant('TOAST.SAVED'));
  }
}
