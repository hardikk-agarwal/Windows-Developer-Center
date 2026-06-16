using System;

// Minimal real Windows console app used to demonstrate the Trusted
// Developer Program signing flow end-to-end.
class HelloTDP
{
    static void Main()
    {
        Console.WriteLine("==================================================");
        Console.WriteLine(" Trusted Developer Program - demo application");
        Console.WriteLine(" This binary is Authenticode code-signed.");
        Console.WriteLine("==================================================");
        Console.WriteLine("Hello from a verified developer!");
    }
}
