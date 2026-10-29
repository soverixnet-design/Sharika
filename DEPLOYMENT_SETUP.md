# Sharika: একবার সেটআপ, এরপর স্বয়ংক্রিয় সার্ভার সিঙ্ক

**অবস্থা: প্রস্তুত, কিন্তু ইচ্ছাকৃতভাবে বন্ধ।** `.github/workflows/sharika-server-sync.yml` শুধু GitHub-এর `main` ব্রাঞ্চে পরিবর্তন এলে (বা ম্যানুয়ালি চালালে) কাজ করতে পারে। `SHARIKA_AUTO_DEPLOY=enabled` না থাকলে কোনো কাজই করবে না।

## কী হবে এবং কী হবে না

- GitHub Actions নির্দিষ্ট **non-root** SSH অ্যাকাউন্টে সংযোগ করবে।
- `app/`, `admin/` ও `backend/` কপি হবে ঐ অ্যাকাউন্টের `~/sharika/releases/<commit-sha>/`-তে।
- কপি যাচাই শেষে শুধু `~/sharika/current` symlink নতুন রিলিজে যাবে।
- বিদ্যমান Sovera, Ayra-Ava, LiveKit, Redis, Caddy, Docker এবং Supabase-এ কোনো পরিবর্তন বা restart করবে না।
- **এটি কেবল source-sync; ওয়েবসাইট public করা, API service চালু করা, APK build/publish করা বা গেম/ভয়েস কাজ করছে নিশ্চিত করা নয়।** এগুলোর জন্য আলাদা পরীক্ষিত deployment integration প্রয়োজন।

## মোবাইল দিয়েই একবার করতে হবে

1. প্রথমে Sharika-র source, admin access, Supabase এবং LiveKit-এর পরীক্ষা সম্পন্ন করুন। **Draft PR merge করবেন না, auto deploy enable করবেন না**, যতক্ষণ না পরীক্ষা সফল হচ্ছে।
2. DigitalOcean-এর মোবাইল-ব্রাউজার Console ব্যবহার করে সার্ভারে শুধু Sharika-এর জন্য একটি আলাদা, সীমিত-অধিকার `sharika-deploy` Linux user তৈরি করুন। বিদ্যমান root account/service/port বদলাবেন না।
3. একটি **নতুন dedicated ed25519 SSH deploy keypair** তৈরি করুন। Public key-টি `sharika-deploy`-এর `~/.ssh/authorized_keys`-এ দিন। Private key কেবল GitHub repository secret-এ যাবে; ChatGPT-এ, screenshot-এ বা সাধারণ message-এ নয়।
4. সার্ভারের SSH **host public key fingerprint বিশ্বস্তভাবে যাচাই করে** known_hosts entry সংগ্রহ করুন। Unknown key অন্ধভাবে মেনে নেবেন না; `StrictHostKeyChecking` বন্ধ করবেন না।
5. [Sharika repository settings](https://github.com/soverixnet-design/Sharika/settings/secrets/actions)-এ **Secrets and variables → Actions** খুলে নিচের values দিন।

   **Variables** (এগুলো secret নয়):

   | Name | Value |
   | --- | --- |
   | `SHARIKA_DEPLOY_HOST` | `206.189.238.27` (সঠিক droplet যাচাই করে) |
   | `SHARIKA_DEPLOY_USER` | `sharika-deploy` |
   | `SHARIKA_DEPLOY_PORT` | `22` (SSH port বদলালে প্রকৃত port) |
   | `SHARIKA_AUTO_DEPLOY` | **এখন দেবেন না।** প্রস্তুত/পরীক্ষা শেষ হলে `enabled` দিন। |

   **Secrets**:

   | Name | Value |
   | --- | --- |
   | `SHARIKA_DEPLOY_KEY` | Dedicated private SSH key (পুরো content) |
   | `SHARIKA_DEPLOY_KNOWN_HOSTS` | যাচাইকৃত SSH known_hosts entry |

6. `sharika-deploy` নামের [GitHub Actions environment](https://github.com/soverixnet-design/Sharika/settings/environments) ব্যবহার হবে। চাইলে branch protection ও reviewer approval সেট করুন।
7. প্রথমে `workflow_dispatch` দিয়ে staging/source-sync পরীক্ষা করুন। সাফল্য যাচাইয়ের পর main-এর জন্য `SHARIKA_AUTO_DEPLOY=enabled` চালু করুন। এরপর প্রতিবার main-এর `app/`, `admin/` বা `backend/` পরিবর্তন হলে GitHub স্বয়ংক্রিয়ভাবে source sync করবে।

## বর্তমানে কাজ আটকে থাকার প্রকৃত কারণ

Supabase dashboard-এর screenshot-এ **Services restricted** দেখা গেছে: ৫ GB Free Plan egress-এর মধ্যে ২২.০৮ GB ব্যবহার হয়েছে। শুধু SSH/sync করলে Supabase restriction সরে যাবে না। বর্তমান data backup নিয়ে Supabase quota/billing সমাধান বা **পরিকল্পিত migration** ছাড়া production switch করা উচিত নয়।

## সতর্কতা

- 1 GB RAM-এ বর্তমানে আরও কয়েকটি সেবা চলছে। নতুন service চালু করার আগে memory ও port audit করতে হবে।
- LiveKit HTTP 200 মানেই voice calls, microphone access, token, WSS, ICE বা UDP সব কাজ করছে—এমন নয়।
- Production database delete, server delete বা বিদ্যমান containers stop করবেন না।
- Server key, Supabase service-role key, Firebase admin credential বা ব্যক্তিগত password কখনো public repository-তে দেবেন না।

**যতক্ষণ setup সম্পূর্ণ না হয়, এই workflow সার্ভারে কিছুই বদলাবে না।**
