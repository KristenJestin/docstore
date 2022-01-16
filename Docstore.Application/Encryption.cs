using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace Docstore.Application
{
    public static class Encryption
    {
        private const string KEY_STRING = "WoawInsanePasswd"; // TODO: set in the encrypted configuration file

        private const long MAX_BUFFER_SIZE = 1048576; // 1mb
        private const int IV_LENGTH = 16;

        public static async Task EncryptAsync(string source, string destination)
        {
            var key = Encoding.UTF8.GetBytes(KEY_STRING);

            using var fsEncrypt = new FileStream(destination, FileMode.CreateNew);
            using var alg = CreateAlgorithm(key);
            using var encryptor = alg.CreateEncryptor(key, alg.IV);
            using var csEncrypt = new CryptoStream(fsEncrypt, encryptor, CryptoStreamMode.Write);
            using var fsIn = new FileStream(source, FileMode.Open);

            var iv = alg.IV;
            await fsEncrypt.WriteAsync(iv);

            var buffer = new byte[MAX_BUFFER_SIZE];     //create a buffer (1mb) so only this amount will allocate in the memory and not the whole file
            int read;

            while ((read = await fsIn.ReadAsync(buffer)) > 0)
                await csEncrypt.WriteAsync(buffer.AsMemory(0, read));
        }

        public static async Task EncryptAsync(Stream source, string destination)
        {
            var key = Encoding.UTF8.GetBytes(KEY_STRING);

            using var fsEncrypt = new FileStream(destination, FileMode.CreateNew);
            using var alg = CreateAlgorithm(key);
            using var encryptor = alg.CreateEncryptor(key, alg.IV);
            using var csEncrypt = new CryptoStream(fsEncrypt, encryptor, CryptoStreamMode.Write);
            using var fsIn = source;

            var iv = alg.IV;
            await fsEncrypt.WriteAsync(iv);

            var buffer = new byte[MAX_BUFFER_SIZE];     //create a buffer (1mb) so only this amount will allocate in the memory and not the whole file
            int read;

            while ((read = await fsIn.ReadAsync(buffer)) > 0)
                await csEncrypt.WriteAsync(buffer.AsMemory(0, read));
        }

        public static async Task DecryptAsync(string source, string destination)
        {
            var key = Encoding.UTF8.GetBytes(KEY_STRING);
            var iv = new byte[IV_LENGTH];

            using var fsDecrypt = new FileStream(source, FileMode.Open);
            await fsDecrypt.ReadAsync(iv);

            using var aesAlg = CreateAlgorithm(key);
            using var decryptor = aesAlg.CreateDecryptor(key, iv);
            using var csDecrypt = new CryptoStream(fsDecrypt, decryptor, CryptoStreamMode.Read);
            using var fsOut = new FileStream(destination, FileMode.CreateNew);

            int read;
            byte[] buffer = new byte[MAX_BUFFER_SIZE];

            while ((read = await csDecrypt.ReadAsync(buffer)) > 0)
                await fsOut.WriteAsync(buffer.AsMemory(0, read));
        }



        public static async Task<byte[]> DecryptWithMemoryAsync(string source)
        {

            var key = Encoding.UTF8.GetBytes(KEY_STRING);
            var iv = new byte[IV_LENGTH];

            using var fsDecrypt = new FileStream(source, FileMode.Open);
            await fsDecrypt.ReadAsync(iv);

            using var aesAlg = CreateAlgorithm(key);
            using var decryptor = aesAlg.CreateDecryptor(key, iv);
            using var csDecrypt = new CryptoStream(fsDecrypt, decryptor, CryptoStreamMode.Read);
            // FIXME: use something else than MemoryStream (for processing large files)
            using var msDecrypt = new MemoryStream();

            int read;
            byte[] buffer = new byte[MAX_BUFFER_SIZE];

            while ((read = await csDecrypt.ReadAsync(buffer)) > 0)
                await msDecrypt.WriteAsync(buffer.AsMemory(0, read));

            return msDecrypt.ToArray();
        }


        #region privates
        private static Aes CreateAlgorithm(byte[] key)
        {
            var algorithm = Aes.Create();
            algorithm.KeySize = 256;
            algorithm.BlockSize = 128;
            algorithm.Padding = PaddingMode.PKCS7;
            algorithm.Key = key;
            algorithm.Mode = CipherMode.CFB;

            return algorithm;
        }
        #endregion
    }
}
