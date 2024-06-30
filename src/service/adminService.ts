import User from '../models/userModel';
import Major, { IMajor } from '../models/majorModel';
import Application from '../models/applicationModel';
import * as s3 from '../utils/s3';
import * as semester from '../utils/semester';

export const update = async () => {
  // 포털에 올라오는 2024년도 2학기 이중전공자 합격자 명단은 2024년도 1학기에 이중 '지원'한 사람들 중 합격한 사람들이다.
  // 서비스 모의지원의 경우, 모의지원 데이터의 'applySemester'의 값이 2024-1인 사람들이다.
  // 이중전공자 합격자 명단이 올라와서 이 API를 호출하는 시점은 2024년도 1학기이다. (매년 7월, 1월에 합격자 명단이 발표될 때)
  const currentSemester = semester.getCurrentSemester(); // 이중 '지원'한 학기, 합격자 명단이 올라온 학기, 서비스 데이터에 저장되는 학기
  const nextSemester = semester.getNextSemester(); // 이중 '진입'하는 학기, 포털에 올라오는 합격자 명단의 학기

  // 모의지원자들 중 합격자 수, 불합격자(합격자 리스트에 없는 사람들) 수
  let passCount = 0,
    failCount = 0;

  // 합격자 처리
  const passers = await s3.getJSONFromS3({
    Key: `passers/${nextSemester}.json`,
  });

  for (const passer of passers) {
    // 1. 일치하는 사용자 찾기
    const studentIdRegex = new RegExp(
      `^${passer['학번'].replace(/\*/g, '.*')}$`,
    );
    const nameRegex = new RegExp(`^${passer['성명'].replace(/\*/g, '.*')}$`);

    const users = await User.find({
      studentId: studentIdRegex,
      name: nameRegex,
    });

    if (users.length === 0) {
      console.log('일치하는 사용자가 없습니다.');
      continue;
    }

    const secondMajor = (await Major.findOne({
      name: passer['이중전공학과'],
    })) as IMajor;

    let user = users[0];

    if (users.length > 1) {
      // 일치하는 학생이 여러 명일 경우, 모의지원한 이중전공 학과가 일치하는 학생을 찾는다.
      for (const u of users) {
        const application = await Application.findOne({
          candidateId: u._id,
          applySemester: currentSemester,
        });

        if (
          application &&
          application.applyMajor1.toString() === secondMajor._id.toString()
        ) {
          user = u;
          break;
        }
      }
    }

    // 2. 일치하는 모의지원 데이터 찾기
    const application = await Application.findOne({
      candidateId: user._id,
      applySemester: currentSemester,
    });

    if (!application) {
      console.log('이번 학기 지원 정보가 없습니다.');
      continue;
    }

    if (application.applyMajor1.toString() !== secondMajor._id.toString()) {
      console.log('이중전공 학과가 일치하지 않습니다.');
      continue;
    }

    // 3. 데이터 갱신
    application.pnp = 'PASS';
    passCount += 1;

    // 3-1. 이중 희망자 관련 데이터 삭제
    await User.updateOne(
      { _id: user._id },
      {
        $unset: {
          hopeMajor1: 1,
          hopeMajor2: 1,
          hopeSemester: 1,
          curGPA: 1,
          changeGPA: 1,
          isApplied: 1,
        },
      },
    );
    // 3-2. 이중 합격자 관련 데이터 추가
    user.role = 'passer';
    user.secondMajor = secondMajor._id;
    user.passSemester = application.applySemester; // 서비스 모의지원 학기 기준으로
    user.passGPA = application.applyGPA;

    await user.save();
    await application.save();
  }

  // 불합격자 처리 - 합격자 처리 후 남은 모의지원자들은 불합격자로 처리
  // FIXME: 지금은 데이터 건들면 안 되니 주석 처리
  // const users = await User.find({ isApplied: true });

  // for (const user of users) {
  //   // 1. 사용자 모의 지원 정보 초기화
  //   user.isApplied = false;
  //   await user.save();

  //   // 2. 모의 지원 정보 불합격으로 변경
  //   const application = await Application.findOne({
  //     candidateId: user._id,
  //     applySemester: currentSemester,
  //   });

  //   application!.pnp = 'FAIL';
  //   failCount += 1;

  //   await application!.save();

  //   failCount += 1;
  // }

  return { passCount, failCount };
};
