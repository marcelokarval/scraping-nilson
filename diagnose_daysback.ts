#!/usr/bin/env ts-node
// Script de diagnóstico para verificar o processamento de daysBack nos runners

import { MA_DEFAULT_OPTIONS } from './runners/MA/config';

class DiagnosticRunner {
  private runOptions: any;

  constructor(options: any) {
    this.runOptions = options;
  }

  testDateProcessing() {
    console.log('🔍 Diagnóstico de processamento de datas\n');
    
    console.log('📋 Opções recebidas pelo runner:');
    console.log(JSON.stringify(this.runOptions, null, 2));
    console.log('');
    
    // Simular exatamente o que os runners fazem
    const end = new Date();
    const start = new Date();
    
    // Esta é a lógica exata dos runners
    const daysBack = typeof this.runOptions.daysBack === 'number' 
      ? this.runOptions.daysBack 
      : parseInt(process.env.LAST_N_DAYS || '0', 10);
    
    console.log('🧮 Lógica de cálculo:');
    console.log(`   typeof this.runOptions.daysBack === 'number': ${typeof this.runOptions.daysBack === 'number'}`);
    console.log(`   this.runOptions.daysBack: ${this.runOptions.daysBack}`);
    console.log(`   process.env.LAST_N_DAYS: ${process.env.LAST_N_DAYS || 'undefined'}`);
    console.log(`   daysBack calculado: ${daysBack}`);
    console.log('');
    
    start.setDate(end.getDate() - (isNaN(daysBack) ? 0 : daysBack));
    
    const fmt = (d: Date) => `${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}/${d.getFullYear()}`;
    const begin = fmt(start);
    const endv = fmt(end);
    
    console.log('📅 Resultado do filtro de datas:');
    console.log(`   daysBack aplicado: ${daysBack}`);
    console.log(`   Data início: ${begin}`);
    console.log(`   Data fim: ${endv}`);
    console.log(`   Diferença em dias: ${Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))}`);
    console.log('');
    
    // Verificar se a data calculada está correta
    const expectedStart = new Date();
    expectedStart.setDate(expectedStart.getDate() - 5);
    const expectedBegin = fmt(expectedStart);
    
    console.log('✅ Verificação:');
    console.log(`   Data esperada para 5 dias atrás: ${expectedBegin}`);
    console.log(`   Data calculada: ${begin}`);
    console.log(`   Datas coincidem: ${begin === expectedBegin ? '✅ SIM' : '❌ NÃO'}`);
  }
}

// Testar com as opções padrão do MA
console.log('🧪 TESTE 1: Opções padrão do MA_DEFAULT_OPTIONS');
const test1 = new DiagnosticRunner(MA_DEFAULT_OPTIONS);
test1.testDateProcessing();

console.log('\n' + '='.repeat(60) + '\n');

// Testar com opções como seriam passadas no executor
console.log('🧪 TESTE 2: Opções como passadas no executor (spread)');
const test2 = new DiagnosticRunner({ ...MA_DEFAULT_OPTIONS, departmentContains: 'PF_DEPT' });
test2.testDateProcessing();

console.log('\n' + '='.repeat(60) + '\n');

// Testar com daysBack como string (possível problema)
console.log('🧪 TESTE 3: daysBack como string (possível problema)');
const test3 = new DiagnosticRunner({ ...MA_DEFAULT_OPTIONS, daysBack: '5' });
test3.testDateProcessing();

console.log('\n' + '='.repeat(60) + '\n');

// Testar sem daysBack (fallback para env)
console.log('🧪 TESTE 4: Sem daysBack (fallback para LAST_N_DAYS)');
const optionsWithoutDaysBack = { ...MA_DEFAULT_OPTIONS };
delete optionsWithoutDaysBack.daysBack;
const test4 = new DiagnosticRunner(optionsWithoutDaysBack);
test4.testDateProcessing();