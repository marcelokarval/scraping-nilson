import PARunnerV1 from './pa_runner_v1_clean';

(async function main(){
  const runner = new PARunnerV1();
  try {
    await runner.run();
    console.log(new Date().toISOString(), 'PA executor finished successfully');
  } catch (err) {
    console.error(new Date().toISOString(), 'PA executor failed', err);
    process.exitCode = 1;
  }
})();
