using Docstore.App.Models.Forms;
using FluentValidation;

namespace Docstore.App.Validators
{
    public class RegisterFormValidator : AbstractValidator<RegisterForm>
    {
        public RegisterFormValidator()
        {
            RuleFor(x => x.UserName)
                .NotEmpty().MaximumLength(100);

            RuleFor(x => x.Email)
                .NotEmpty().EmailAddress();

            RuleFor(x => x.Password)
                .NotEmpty();
        }
    }
}
